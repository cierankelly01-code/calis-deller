-- Phase 2: the full digital SFBB diary.
--
-- Same integrity model as 0001: log tables (evidence an EHO inspects) are
-- append-only — no UPDATE/DELETE policy exists, so RLS denies them.
-- Config tables (suppliers, products, cleaning_tasks) allow UPDATE for
-- edits/deactivation but never DELETE, so historic log rows always resolve.

-- SUPPLIERS (config) ----------------------------------------------------

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;

create policy "suppliers_select_all" on suppliers
  for select to anon using (true);

create policy "suppliers_insert" on suppliers
  for insert to anon with check (true);

create policy "suppliers_update" on suppliers
  for update to anon using (true) with check (true);

-- PRODUCTS + ALLERGENS (config) ------------------------------------------
-- The 14 UK FSA allergens, stored as an array of fixed keys. A CHECK
-- constraint stops typos ever entering the matrix — the UI offers toggles,
-- never free text, for the allergens themselves.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  allergens text[] not null default '{}',
  may_contain text[] not null default '{}', -- cross-contamination risks
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_allergens_valid check (
    allergens <@ array['celery','gluten','crustaceans','eggs','fish','lupin','milk','molluscs','mustard','peanuts','sesame','soya','sulphites','tree_nuts']::text[]
  ),
  constraint products_may_contain_valid check (
    may_contain <@ array['celery','gluten','crustaceans','eggs','fish','lupin','milk','molluscs','mustard','peanuts','sesame','soya','sulphites','tree_nuts']::text[]
  )
);

alter table products enable row level security;

create policy "products_select_all" on products
  for select to anon using (true);

create policy "products_insert" on products
  for insert to anon with check (true);

create policy "products_update" on products
  for update to anon using (true) with check (true);

-- COOKING LOGS (append-only) ----------------------------------------------
-- Hot food temperature checks. UK guidance: cooking and reheating must
-- reach 75°C+ core; hot holding must stay at 63°C+. in_range computed
-- client-side against the check_type's target.

create table if not exists cooking_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  staff_id uuid not null references staff(id),
  check_type text not null default 'cooking'
    check (check_type in ('cooking', 'reheating', 'hot_hold')),
  product_id uuid references products(id), -- null when typed as free text
  product_name text not null,              -- always captured, survives product edits
  quantity int not null default 1,
  temp_c numeric(4,1) not null,
  in_range boolean not null,               -- met the check_type's target at capture time
  corrective_action text,                  -- required client-side when not in range
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references cooking_logs(id),
  created_by_device text
);

alter table cooking_logs enable row level security;

create policy "cooking_logs_select_all" on cooking_logs
  for select to anon using (true);

create policy "cooking_logs_insert" on cooking_logs
  for insert to anon with check (true);

create index if not exists cooking_logs_recorded_at_idx on cooking_logs (recorded_at desc);

-- DELIVERY LOGS (append-only) ----------------------------------------------

create table if not exists delivery_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  staff_id uuid not null references staff(id),
  supplier_id uuid references suppliers(id),
  supplier_name text not null,
  vehicle_temp_c numeric(4,1),  -- van temperature, when applicable
  chilled_temp_c numeric(4,1),  -- probe of chilled goods (target ≤ 5°C, reject > 8°C)
  frozen_temp_c numeric(4,1),   -- probe of frozen goods (target ≤ -18°C)
  packaging_ok boolean not null default true,
  in_date_ok boolean not null default true,
  accepted boolean not null,
  rejection_reason text,        -- required client-side when rejected
  notes text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references delivery_logs(id),
  created_by_device text
);

alter table delivery_logs enable row level security;

create policy "delivery_logs_select_all" on delivery_logs
  for select to anon using (true);

create policy "delivery_logs_insert" on delivery_logs
  for insert to anon with check (true);

create index if not exists delivery_logs_recorded_at_idx on delivery_logs (recorded_at desc);

-- CLEANING TASKS (config) + CLEANING LOGS (append-only) ---------------------

create table if not exists cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session text not null check (session in ('open', 'close', 'both')),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table cleaning_tasks enable row level security;

create policy "cleaning_tasks_select_all" on cleaning_tasks
  for select to anon using (true);

create policy "cleaning_tasks_insert" on cleaning_tasks
  for insert to anon with check (true);

create policy "cleaning_tasks_update" on cleaning_tasks
  for update to anon using (true) with check (true);

-- One row per task ticked off. "Did we do the opening clean on the 14th?"
-- is answered by querying logs for that date + session.

create table if not exists cleaning_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  staff_id uuid not null references staff(id),
  task_id uuid not null references cleaning_tasks(id),
  session text not null check (session in ('open', 'close')),
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references cleaning_logs(id),
  created_by_device text
);

alter table cleaning_logs enable row level security;

create policy "cleaning_logs_select_all" on cleaning_logs
  for select to anon using (true);

create policy "cleaning_logs_insert" on cleaning_logs
  for insert to anon with check (true);

create index if not exists cleaning_logs_recorded_at_idx on cleaning_logs (recorded_at desc);

-- PROBE CALIBRATION LOGS (append-only) --------------------------------------
-- Weekly probe accuracy check: ice water should read 0°C (±1), boiling
-- water 100°C (±1). EHOs ask for these; most paper diaries miss them.

create table if not exists probe_calibration_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  staff_id uuid not null references staff(id),
  method text not null check (method in ('ice', 'boiling')),
  reading_c numeric(4,1) not null,
  pass boolean not null, -- within ±1°C of 0 / 100 at capture time
  corrective_action text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references probe_calibration_logs(id),
  created_by_device text
);

alter table probe_calibration_logs enable row level security;

create policy "probe_calibration_logs_select_all" on probe_calibration_logs
  for select to anon using (true);

create policy "probe_calibration_logs_insert" on probe_calibration_logs
  for insert to anon with check (true);

create index if not exists probe_calibration_logs_recorded_at_idx on probe_calibration_logs (recorded_at desc);
