-- Stock tracker: what sells, what doesn't, what it makes, what gets binned.
--
-- Not EHO evidence — this is the shop's own business data — but it follows
-- the same integrity model as the food logs so the numbers can be trusted:
--
--   stock_lines — which products are tracked, counted by the item or by the
--                 kg, with cost and sell price per unit. One list for both
--                 shops (the range and prices are the same), manager-edited.
--                 Kept off the products table so prices can later be hidden
--                 from staff by changing one read policy, without touching
--                 the allergen guide.
--   stock_logs  — append-only, per shop, three kinds of entry:
--       count     — the close count for one product: how much came in and
--                   how much was binned since the last count, and how much
--                   is left now. A recount the same day supersedes the
--                   earlier one (latest wins), so nothing is ever edited.
--       sold_out  — "we've run out of X", with the time. Hidden demand: the
--                   count can never show sales you didn't have stock for.
--       day_note  — what the day was like (sunny, rain, busy, event…), so
--                   a big Saturday can be explained later.
--   Sold for a day = previous count + came in − binned − left now, derived
--   in the app (src/lib/stock/ledger.ts), never stored.
--
-- Deliveries gain an optional invoice total, so weekly spend per supplier
-- can be set against sales.

alter table public.delivery_logs
  add column if not exists invoice_total numeric(10,2);
alter table public.delivery_logs
  add constraint food_log_invoice_total check (invoice_total is null or invoice_total between 0 and 100000) not valid;

create table if not exists public.stock_lines (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id),
  unit text not null default 'each' check (unit in ('each', 'kg')),
  cost_price numeric(10,2) check (cost_price is null or cost_price between 0 and 10000),
  sell_price numeric(10,2) check (sell_price is null or sell_price between 0 and 10000),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_lines enable row level security;
revoke all on public.stock_lines from public, anon, authenticated;
grant select, insert, update on public.stock_lines to authenticated;
-- To make prices manager-only later, change this one policy to
-- "= 'manager'" (and hide the stock pages from staff in the app).
create policy food_log_read on public.stock_lines for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.stock_lines for insert to authenticated
  with check ((select food_log_private.current_role()) = 'manager');
create policy food_log_update on public.stock_lines for update to authenticated
  using ((select food_log_private.current_role()) = 'manager')
  with check ((select food_log_private.current_role()) = 'manager');
create trigger food_log_rate_limit before insert or update on public.stock_lines
  for each row execute function food_log_private.limit_write();

create table if not exists public.stock_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  event text not null check (event in ('count', 'sold_out', 'day_note')),
  product_id uuid references public.products(id),
  product_name text,                    -- always captured, survives product edits
  unit text check (unit in ('each', 'kg')),
  came_in numeric(10,3),                -- count: since the last count
  binned numeric(10,3),                 -- count: since the last count
  on_hand numeric(10,3),                -- count: left now
  tags text[] not null default '{}',    -- day_note
  note text,
  business_date date not null,          -- server-derived: the UK trading day
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.stock_logs(id),
  created_by_device text,
  -- Every comparison is null-guarded: a CHECK that evaluates to null passes.
  constraint stock_event_shape check (
    (event = 'count' and product_name is not null and length(btrim(product_name)) between 1 and 200 and unit is not null
      and came_in is not null and binned is not null and on_hand is not null
      and came_in between 0 and 100000 and binned between 0 and 100000 and on_hand between 0 and 100000
      and cardinality(tags) = 0)
    or (event = 'sold_out' and product_name is not null and length(btrim(product_name)) between 1 and 200
      and unit is null and came_in is null and binned is null and on_hand is null and cardinality(tags) = 0)
    or (event = 'day_note' and product_id is null and product_name is null
      and unit is null and came_in is null and binned is null and on_hand is null
      and (cardinality(tags) > 0 or coalesce(length(btrim(note)), 0) > 0))
  ),
  constraint stock_tags_valid check (
    cardinality(tags) <= 11 and tags <@ array['sunny','hot','rain','cold','busy','quiet','event','bank_holiday','school_holidays','short_staffed','closed_early']::text[]
  ),
  constraint stock_note_length check (length(note) <= 2000),
  constraint stock_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);

create index if not exists stock_logs_recorded_at_idx on public.stock_logs (recorded_at desc);
create index if not exists stock_logs_site_day_idx on public.stock_logs (site_id, business_date);
create index if not exists stock_logs_user_idx on public.stock_logs (authenticated_user_id);

alter table public.stock_logs enable row level security;
revoke all on public.stock_logs from public, anon, authenticated;
grant select, insert on public.stock_logs to authenticated;
create policy food_log_read on public.stock_logs for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.stock_logs for insert to authenticated
  with check ((select food_log_private.current_role()) in ('staff', 'manager') and authenticated_user_id = (select auth.uid()));
create trigger food_log_stamp before insert on public.stock_logs
  for each row execute function food_log_private.stamp_log();
create trigger food_log_rate_limit before insert or update on public.stock_logs
  for each row execute function food_log_private.limit_write();

-- Extends the stamp trigger (same function, all log tables) with the stock
-- rule: the trading day is derived here from when the count was taken.
create or replace function food_log_private.stamp_log()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare unit_site uuid; task_site uuid; batch_site uuid; delivery_site uuid;
begin
  new.authenticated_user_id := auth.uid();
  new.synced_at := clock_timestamp();
  select s.site_id into new.site_id from public.staff s where s.id = new.staff_id;
  if new.site_id is null then
    raise exception 'Staff member not found';
  end if;
  if tg_table_name = 'fridge_temp_logs' then
    select new.reading_c between u.target_min_c and u.target_max_c, u.site_id
      into new.in_range, unit_site
      from public.fridge_units u where u.id = new.unit_id;
    if unit_site is distinct from new.site_id then
      raise exception 'Fridge belongs to a different store';
    end if;
  elsif tg_table_name = 'cooking_logs' then
    new.in_range := new.temp_c >= case when new.check_type = 'hot_hold' then 63 else 75 end;
  elsif tg_table_name = 'cleaning_logs' then
    select t.site_id into task_site from public.cleaning_tasks t where t.id = new.task_id;
    if task_site is distinct from new.site_id then
      raise exception 'Cleaning task belongs to a different store';
    end if;
  elsif tg_table_name = 'probe_calibration_logs' then
    new.pass := abs(new.reading_c - case when new.method = 'ice' then 0 else 100 end) <= 1;
  elsif tg_table_name = 'counter_stock_logs' then
    select u.site_id into unit_site from public.fridge_units u where u.id = new.unit_id;
    if unit_site is distinct from new.site_id then
      raise exception 'Serve-over belongs to a different store';
    end if;
    if new.event = 'put_out' then
      if new.delivery_log_id is not null then
        select d.site_id into delivery_site from public.delivery_logs d where d.id = new.delivery_log_id;
        if delivery_site is distinct from new.site_id then
          raise exception 'Delivery belongs to a different store';
        end if;
      end if;
      new.discard_by := least(
        new.pack_use_by,
        (new.recorded_at at time zone 'Europe/London')::date + (new.open_life_days - 1)
      );
    else
      select b.site_id into batch_site from public.counter_stock_logs b
        where b.client_id = new.batch_client_id and b.event = 'put_out';
      if batch_site is distinct from new.site_id then
        raise exception 'Batch not found';
      end if;
    end if;
  elsif tg_table_name = 'ambient_display_logs' then
    if new.event = 'put_out' then
      -- The shop's window (default three hours); never beyond the legal four.
      new.display_minutes := least(coalesce(new.display_minutes, 180), 240);
      new.off_by := new.recorded_at + new.display_minutes * interval '1 minute';
    else
      new.display_minutes := null;
      new.off_by := null;
      if new.event = 'taken_off' then
        select b.site_id into batch_site from public.ambient_display_logs b
          where b.client_id = new.batch_client_id and b.event = 'put_out';
        if batch_site is distinct from new.site_id then
          raise exception 'Batch not found';
        end if;
      end if;
    end if;
  elsif tg_table_name = 'stock_logs' then
    new.business_date := (new.recorded_at at time zone 'Europe/London')::date;
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;
