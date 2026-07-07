-- Phase 1: staff picker + fridge/freezer temperature log.
--
-- Data integrity model used throughout this project: log tables (the
-- evidentiary records an EHO inspects) are append-only. Nothing is ever
-- UPDATEd or DELETEd — a correction is a new row referencing the original
-- via corrects_entry_id, and RLS denies UPDATE/DELETE outright (no policy
-- is defined for those operations, so they're denied by default once RLS
-- is enabled). Config tables (staff, fridge_units) are not evidentiary
-- records, so normal UPDATE is allowed for things like deactivating a
-- staff member — but rows are still never DELETEd, so historic log rows
-- always resolve to a valid foreign key.

create extension if not exists pgcrypto;

-- STAFF ---------------------------------------------------------------

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

create policy "staff_select_all" on staff
  for select to anon using (true);

create policy "staff_insert" on staff
  for insert to anon with check (true);

create policy "staff_update" on staff
  for update to anon using (true) with check (true);

-- FRIDGE / FREEZER UNITS ------------------------------------------------

create table if not exists fridge_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit_type text not null check (unit_type in ('fridge', 'freezer')),
  target_min_c numeric(4,1) not null,
  target_max_c numeric(4,1) not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table fridge_units enable row level security;

create policy "fridge_units_select_all" on fridge_units
  for select to anon using (true);

create policy "fridge_units_insert" on fridge_units
  for insert to anon with check (true);

create policy "fridge_units_update" on fridge_units
  for update to anon using (true) with check (true);

-- FRIDGE / FREEZER TEMPERATURE LOGS (append-only) ------------------------

create table if not exists fridge_temp_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique, -- device-generated, makes offline sync idempotent
  staff_id uuid not null references staff(id),
  unit_id uuid not null references fridge_units(id),
  period text not null check (period in ('am', 'mid', 'pm', 'other')),
  reading_c numeric(4,1) not null,
  in_range boolean not null, -- computed client-side against the unit's target band at capture time
  corrective_action text,
  recorded_at timestamptz not null, -- when the check actually happened, device-set
  synced_at timestamptz not null default now(), -- when it reached the server (audit trail against back-filling)
  corrects_entry_id uuid references fridge_temp_logs(id),
  created_by_device text
);

alter table fridge_temp_logs enable row level security;

create policy "fridge_temp_logs_select_all" on fridge_temp_logs
  for select to anon using (true);

create policy "fridge_temp_logs_insert" on fridge_temp_logs
  for insert to anon with check (true);

create index if not exists fridge_temp_logs_recorded_at_idx on fridge_temp_logs (recorded_at desc);
create index if not exists fridge_temp_logs_unit_id_idx on fridge_temp_logs (unit_id);
