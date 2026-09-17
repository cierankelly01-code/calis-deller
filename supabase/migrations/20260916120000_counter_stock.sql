-- Counter stock rotation: the register for open food sold loose from the
-- serve-over fridges (ham, turkey, pork pies, scotch eggs, salads…).
--
-- Legal position (FSA SFBB for retailers, "Stock control" / "Ready-to-eat
-- food" safe methods): it is an offence to sell food past the pack's use-by;
-- food removed from its original packaging must have a method of keeping
-- track of when it should be sold or thrown away; stock must rotate first-in
-- first-out. Local authority practice (and this shop's EHO) is an open life
-- of 3 days INCLUDING the day it was opened, unless the pack says less.
--
-- Two append-only events per batch:
--   put_out   — a new open batch went into a serve-over. The server derives
--               discard_by = earliest of (pack use-by, opened + open life - 1)
--               so nobody ever counts days on their fingers.
--   taken_off — that batch left the counter, with a reason (sold out / end of
--               life / quality) and who did it. Without this the record looks
--               like ham that went out ten days ago and vanished.
-- "What's on the counter right now" is every put_out without a taken_off,
-- derived client-side — no mutable state, same integrity model as every
-- other log table.

-- Each product carries its own open life so the put-out screen never asks.
alter table public.products
  add column if not exists open_life_days int not null default 3;
alter table public.products
  add constraint food_log_open_life check (open_life_days between 1 and 90) not valid;

create table if not exists public.counter_stock_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  event text not null check (event in ('put_out', 'taken_off')),
  batch_client_id uuid,                 -- taken_off: client_id of the put_out row
  product_id uuid references public.products(id),
  product_name text not null,           -- always captured, survives product edits
  unit_id uuid not null references public.fridge_units(id), -- which serve-over
  open_life_days int,                   -- put_out: days including the day opened
  pack_use_by date,                     -- put_out: the pack's own use-by, if any
  discard_by date,                      -- put_out: server-derived, never trusted from the client
  batch_code text,                      -- put_out: off the box, for traceability
  delivery_log_id uuid references public.delivery_logs(id), -- put_out: which delivery it came in on
  reason text check (reason in ('sold_out', 'end_of_life', 'quality', 'other')),
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.counter_stock_logs(id),
  created_by_device text,
  constraint counter_stock_event_shape check (
    (event = 'put_out' and batch_client_id is null and open_life_days between 1 and 90 and discard_by is not null and reason is null)
    or (event = 'taken_off' and batch_client_id is not null and reason is not null and open_life_days is null and pack_use_by is null and discard_by is null)
  ),
  constraint counter_stock_product_name check (length(btrim(product_name)) between 1 and 200),
  constraint counter_stock_note_length check (length(note) <= 2000),
  constraint counter_stock_batch_code_length check (length(batch_code) <= 200),
  constraint counter_stock_device_length check (length(created_by_device) <= 2000),
  constraint counter_stock_reason_given check (reason is distinct from 'other' or coalesce(length(btrim(note)), 0) > 0),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);

create index if not exists counter_stock_logs_recorded_at_idx on public.counter_stock_logs (recorded_at desc);
create index if not exists counter_stock_logs_site_id_idx on public.counter_stock_logs (site_id);
create index if not exists counter_stock_logs_batch_idx on public.counter_stock_logs (batch_client_id) where batch_client_id is not null;
create index if not exists counter_stock_logs_user_idx on public.counter_stock_logs (authenticated_user_id);

-- Same access model as the other evidence tables: read for staff/manager,
-- insert as yourself, never update or delete.
alter table public.counter_stock_logs enable row level security;
revoke all on public.counter_stock_logs from public, anon, authenticated;
grant select, insert on public.counter_stock_logs to authenticated;
create policy food_log_read on public.counter_stock_logs for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.counter_stock_logs for insert to authenticated
  with check ((select food_log_private.current_role()) in ('staff', 'manager') and authenticated_user_id = (select auth.uid()));
create trigger food_log_stamp before insert on public.counter_stock_logs
  for each row execute function food_log_private.stamp_log();
create trigger food_log_rate_limit before insert or update on public.counter_stock_logs
  for each row execute function food_log_private.limit_write();

-- Extends the stamp trigger from 20260914090000 (same function, same tables)
-- with the counter rules: the serve-over must belong to the same shop, the
-- discard date is derived here, and a taken_off must point at a real batch
-- from the same shop.
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
      -- "3 days" means the day it was opened plus two more; least() skips a
      -- null pack date, and a shorter pack use-by always wins.
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
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;

-- The daily counter checks belong on the opening and closing checklists,
-- where the EHO expects to find them (SFBB opening/closing checks: "throw
-- away food past its date"). The write-limit trigger requires a signed-in
-- food-log account; this runs from the SQL editor, so pause it for the
-- insert (as the sites backfill did).
alter table public.cleaning_tasks disable trigger food_log_rate_limit;
insert into public.cleaning_tasks (site_id, name, session, sort_order)
select s.id, v.name, v.session, 0
from public.sites s
cross join (values
  ('Counter stock — check dates, bin anything past its date', 'open'),
  ('Counter stock — take off anything on its last day', 'close')
) as v(name, session)
where not exists (
  select 1 from public.cleaning_tasks t where t.site_id = s.id and t.name = v.name
);
alter table public.cleaning_tasks enable trigger food_log_rate_limit;
