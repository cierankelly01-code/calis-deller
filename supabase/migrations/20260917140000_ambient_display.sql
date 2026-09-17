-- Sandwiches on top of the counter: the 4-hour rule.
--
-- Legal position (Food Safety and Hygiene (England) Regulations 2013,
-- Schedule 4 para 5): chilled food may be kept for service or on display
-- above 8°C for a single period of LESS THAN FOUR HOURS, and only if it has
-- not previously been kept for display above 8°C. FSA SFBB: after that
-- period, throw it away or keep it chilled at 8°C or below until used — it
-- never goes back out at room temperature.
--
-- Three append-only events, all per product with a quantity:
--   made      — sandwiches made and chilled: the fridge reserve for the day.
--   put_out   — some of the reserve went on top of the counter. The server
--               stamps off_by = recorded_at + 4 hours; the app alarms before.
--   taken_off — that put-out came off: sold out, chilled (sell from the
--               fridge, never out again) or binned, with how many were left.
-- "What's out right now" = put_out rows with no taken_off; "what's in the
-- fridge" = today's made minus today's put_out, per product. Chilled
-- returns are deliberately NOT added back to the reserve.

-- Sandwiches are products too (they carry allergens), flagged by category so
-- the sandwich screens list only sandwiches and the counter screens don't.
alter table public.products
  add column if not exists category text not null default 'deli';
alter table public.products
  add constraint food_log_product_category check (category in ('deli', 'sandwich')) not valid;

create table if not exists public.ambient_display_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  event text not null check (event in ('made', 'put_out', 'taken_off')),
  batch_client_id uuid,                 -- taken_off: client_id of the put_out row
  product_id uuid references public.products(id),
  product_name text not null,
  quantity int not null,                -- made/put_out: how many; taken_off: how many were left
  off_by timestamptz,                   -- put_out: server-derived, the four-hour limit
  outcome text check (outcome in ('sold_out', 'chilled', 'binned')),
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.ambient_display_logs(id),
  created_by_device text,
  constraint ambient_event_shape check (
    (event in ('made', 'put_out') and batch_client_id is null and outcome is null and quantity between 1 and 1000)
    or (event = 'taken_off' and batch_client_id is not null and outcome is not null and quantity between 0 and 1000)
  ),
  constraint ambient_off_by_shape check ((event = 'put_out') = (off_by is not null)),
  constraint ambient_product_name check (length(btrim(product_name)) between 1 and 200),
  constraint ambient_note_length check (length(note) <= 2000),
  constraint ambient_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);

create index if not exists ambient_display_logs_recorded_at_idx on public.ambient_display_logs (recorded_at desc);
create index if not exists ambient_display_logs_site_id_idx on public.ambient_display_logs (site_id);
create index if not exists ambient_display_logs_batch_idx on public.ambient_display_logs (batch_client_id) where batch_client_id is not null;
create index if not exists ambient_display_logs_user_idx on public.ambient_display_logs (authenticated_user_id);

alter table public.ambient_display_logs enable row level security;
revoke all on public.ambient_display_logs from public, anon, authenticated;
grant select, insert on public.ambient_display_logs to authenticated;
create policy food_log_read on public.ambient_display_logs for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.ambient_display_logs for insert to authenticated
  with check ((select food_log_private.current_role()) in ('staff', 'manager') and authenticated_user_id = (select auth.uid()));
create trigger food_log_stamp before insert on public.ambient_display_logs
  for each row execute function food_log_private.stamp_log();
create trigger food_log_rate_limit before insert or update on public.ambient_display_logs
  for each row execute function food_log_private.limit_write();

-- Extends the stamp trigger (same function, all log tables) with the
-- ambient rules: off_by is derived here, and a taken_off must point at a
-- real put_out from the same shop.
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
      new.off_by := new.recorded_at + interval '4 hours';
    else
      new.off_by := null;
      if new.event = 'taken_off' then
        select b.site_id into batch_site from public.ambient_display_logs b
          where b.client_id = new.batch_client_id and b.event = 'put_out';
        if batch_site is distinct from new.site_id then
          raise exception 'Batch not found';
        end if;
      end if;
    end if;
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;

-- The regular line-up, as shared products. Bread means gluten; the cheese
-- ones mean milk. Everything else is for the owner to confirm in the
-- Allergen Guide — hence the note. Skipped where the name already exists.
alter table public.products disable trigger food_log_rate_limit;
insert into public.products (name, category, allergens, may_contain, notes)
select v.name, 'sandwich', v.allergens::text[], '{}', 'Seeded sandwich — confirm the allergens'
from (values
  ('Ham Salad',      '{gluten}'),
  ('Ham & Cheese',   '{gluten,milk}'),
  ('Cheese & Onion', '{gluten,milk}'),
  ('Turkey Salad',   '{gluten}')
) as v(name, allergens)
where not exists (
  select 1 from public.products p where lower(btrim(p.name)) = lower(v.name)
);
update public.products set category = 'sandwich'
where category <> 'sandwich' and lower(btrim(name)) in ('ham salad', 'ham & cheese', 'cheese & onion', 'turkey salad');
alter table public.products enable trigger food_log_rate_limit;
