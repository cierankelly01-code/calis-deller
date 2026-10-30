-- The SFBB book inside the app (after the Stratford inspection, 13 Oct 2026:
-- the officer praised the tablet records but the written safe methods were
-- kept at another shop). Six new append-only logs, one config list and a
-- private bucket for staff certificates:
--
--   hot_batch_logs    — the cooling clock. A cooked batch that's going to be
--                       sold warm off the side gets a 2-hour clock from the
--                       moment it comes out of the oven (SFBB hot holding: out
--                       of hot holding for up to two hours, once). Events:
--                         out   — links the cooking check that proved 75°C;
--                                 the server stamps due_by = +2 hours.
--                         probe — a temperature while it cools ("prove it").
--                         done  — chilled (into the chilled counter/fridge),
--                                 sold out, or binned.
--   method_records    — a manager signs off a safe method for one shop, with
--                       that shop's own way of doing it. Latest row wins.
--   training_records  — per staff member: certificates (with expiry, and an
--                       optional uploaded copy), safe methods trained on,
--                       induction. Manager-only: it is personal data.
--   health_logs       — sent home ill / cleared to return (48 hours free of
--                       symptoms). Manager-only, special-category data: the
--                       app keeps it to the minimum.
--   review_logs       — the SFBB 4-weekly review, signed by a manager.
--   site_check_logs   — pest checks, hand-wash sink checks, repairs.
--   food_log_contacts — the SFBB contacts list (pest contractor, EHO,
--                       maintenance), per shop, manager-edited.
--
-- Log rows carry no site_id from the client: stamp_log derives it from the
-- staff member, as for every other log.

create table if not exists public.hot_batch_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  event text not null check (event in ('out', 'probe', 'done')),
  batch_client_id uuid,                 -- probe/done: client_id of the 'out' row
  cooking_client_id uuid,               -- out: the cooking check that proved it was cooked
  product_id uuid references public.products(id),
  product_name text not null,
  quantity int,                         -- out: how many; done: how many were left
  temp_c numeric(5,1),                  -- probe: required; done: optional
  due_by timestamptz,                   -- out: server-derived, two hours
  outcome text check (outcome in ('chilled', 'sold_out', 'binned')),
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.hot_batch_logs(id),
  created_by_device text,
  -- Every comparison is null-guarded: a CHECK that evaluates to null passes.
  constraint hot_batch_event_shape check (
    (event = 'out' and cooking_client_id is not null and batch_client_id is null and outcome is null and temp_c is null
      and quantity is not null and quantity between 1 and 10000)
    or (event = 'probe' and batch_client_id is not null and cooking_client_id is null and outcome is null and quantity is null
      and temp_c is not null)
    or (event = 'done' and batch_client_id is not null and cooking_client_id is null and outcome is not null
      and quantity is not null and quantity between 0 and 10000)
  ),
  constraint hot_batch_due_shape check ((event = 'out') = (due_by is not null)),
  constraint hot_batch_temp check (temp_c is null or temp_c between -100 and 300),
  constraint hot_batch_product_name check (length(btrim(product_name)) between 1 and 200),
  constraint hot_batch_note_length check (length(note) <= 2000),
  constraint hot_batch_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists hot_batch_logs_recorded_at_idx on public.hot_batch_logs (recorded_at desc);
create index if not exists hot_batch_logs_site_id_idx on public.hot_batch_logs (site_id);
create index if not exists hot_batch_logs_batch_idx on public.hot_batch_logs (batch_client_id) where batch_client_id is not null;
create index if not exists hot_batch_logs_user_idx on public.hot_batch_logs (authenticated_user_id);

create table if not exists public.method_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  method_id text not null check (method_id ~ '^[a-z0-9-]{1,60}$'),
  our_way text,                         -- this shop's own way, in the manager's words
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.method_records(id),
  created_by_device text,
  constraint method_our_way_length check (length(our_way) <= 2000),
  constraint method_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists method_records_site_idx on public.method_records (site_id, method_id, recorded_at desc);
create index if not exists method_records_user_idx on public.method_records (authenticated_user_id);

create table if not exists public.training_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),   -- the manager recording it
  authenticated_user_id uuid references auth.users(id),
  trainee_id uuid not null references public.staff(id),
  kind text not null check (kind in ('certificate', 'method', 'induction', 'refresher')),
  topic text not null,                  -- certificate name, or a safe method id
  trained_on date not null,
  expires_on date,
  certificate_path text,                -- object in the food-log-certificates bucket
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.training_records(id),
  created_by_device text,
  constraint training_topic check (length(btrim(topic)) between 1 and 200),
  constraint training_dates check (expires_on is null or expires_on >= trained_on),
  constraint training_path check (certificate_path is null or certificate_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  constraint training_path_kind check (certificate_path is null or kind = 'certificate'),
  constraint training_note_length check (length(note) <= 2000),
  constraint training_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists training_records_site_idx on public.training_records (site_id, trainee_id);
create index if not exists training_records_user_idx on public.training_records (authenticated_user_id);

create table if not exists public.health_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),   -- the manager recording it
  authenticated_user_id uuid references auth.users(id),
  subject_id uuid not null references public.staff(id),
  event text not null check (event in ('sent_home', 'cleared')),
  symptom_free_48h boolean not null default false,
  note text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.health_logs(id),
  created_by_device text,
  constraint health_cleared check (event <> 'cleared' or symptom_free_48h),
  constraint health_note_length check (length(note) <= 2000),
  constraint health_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists health_logs_site_idx on public.health_logs (site_id, recorded_at desc);
create index if not exists health_logs_user_idx on public.health_logs (authenticated_user_id);

create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),   -- the manager signing it
  authenticated_user_id uuid references auth.users(id),
  changes text[] not null default '{}', -- what changed in the four weeks
  all_ok boolean not null,
  problems text,
  actions text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.review_logs(id),
  created_by_device text,
  constraint review_changes check (
    cardinality(changes) <= 7 and changes <@ array['staff','suppliers','menu','equipment','chemicals','methods','premises']::text[]
  ),
  constraint review_problems check (all_ok or coalesce(length(btrim(problems)), 0) > 0),
  constraint review_text_length check (length(problems) <= 2000 and length(actions) <= 2000),
  constraint review_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists review_logs_site_idx on public.review_logs (site_id, recorded_at desc);
create index if not exists review_logs_user_idx on public.review_logs (authenticated_user_id);

create table if not exists public.site_check_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),
  authenticated_user_id uuid references auth.users(id),
  kind text not null check (kind in ('pest', 'hand_wash', 'maintenance')),
  ok boolean not null,
  corrective_action text,
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.site_check_logs(id),
  created_by_device text,
  constraint site_check_action check (ok or coalesce(length(btrim(corrective_action)), 0) > 0),
  constraint site_check_action_length check (length(corrective_action) <= 2000),
  constraint site_check_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists site_check_logs_site_idx on public.site_check_logs (site_id, recorded_at desc);
create index if not exists site_check_logs_user_idx on public.site_check_logs (authenticated_user_id);

create table if not exists public.food_log_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  name text not null,
  role text,                            -- what they're for: "Pest control", "EHO"
  phone text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint food_log_name_length check (length(btrim(name)) between 1 and 200),
  constraint contacts_role_length check (length(role) <= 200),
  constraint contacts_phone check (phone is null or phone ~ '^[0-9 +()-]{3,40}$')
);
create index if not exists food_log_contacts_site_idx on public.food_log_contacts (site_id);

-- Row-level security. Everyone signed in can read the cooling clock, the
-- signed-off methods, reviews, checks and contacts; only managers can read
-- training and health records. Logs are insert-only; nothing is ever
-- updated or deleted.
do $$
declare
  target_table text;
  manager_read text[] := array['training_records', 'health_logs'];
  manager_write text[] := array['method_records', 'training_records', 'health_logs', 'review_logs'];
begin
  foreach target_table in array array['hot_batch_logs','method_records','training_records','health_logs','review_logs','site_check_logs'] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all on public.%I from public, anon, authenticated', target_table);
    execute format('grant select, insert on public.%I to authenticated', target_table);
    execute format('create policy food_log_read on public.%I for select to authenticated using ((select food_log_private.current_role()) %s)',
      target_table, case when target_table = any(manager_read) then '= ''manager''' else 'in (''staff'', ''manager'')' end);
    execute format('create policy food_log_insert on public.%I for insert to authenticated with check ((select food_log_private.current_role()) %s and authenticated_user_id = (select auth.uid()))',
      target_table, case when target_table = any(manager_write) then '= ''manager''' else 'in (''staff'', ''manager'')' end);
    execute format('create trigger food_log_stamp before insert on public.%I for each row execute function food_log_private.stamp_log()', target_table);
    execute format('create trigger food_log_rate_limit before insert or update on public.%I for each row execute function food_log_private.limit_write()', target_table);
  end loop;
end
$$;

alter table public.food_log_contacts enable row level security;
revoke all on public.food_log_contacts from public, anon, authenticated;
grant select, insert, update on public.food_log_contacts to authenticated;
create policy food_log_read on public.food_log_contacts for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.food_log_contacts for insert to authenticated
  with check ((select food_log_private.current_role()) = 'manager');
create policy food_log_update on public.food_log_contacts for update to authenticated
  using ((select food_log_private.current_role()) = 'manager')
  with check ((select food_log_private.current_role()) = 'manager');
create trigger food_log_rate_limit before insert or update on public.food_log_contacts
  for each row execute function food_log_private.limit_write();

-- Extends the stamp trigger (same function, all log tables) with the new
-- tables' rules. Everything above the "new" marker is unchanged from
-- 20260930100000_stock_tracker.sql.
create or replace function food_log_private.stamp_log()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare unit_site uuid; task_site uuid; batch_site uuid; delivery_site uuid; other_site uuid; cooked_ok boolean;
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
  -- new in 20261030100000 ----------------------------------------------------
  elsif tg_table_name = 'hot_batch_logs' then
    if new.event = 'out' then
      -- The clock only starts on a batch proved cooked (75°C) in this shop.
      select c.site_id, c.in_range into other_site, cooked_ok from public.cooking_logs c
        where c.client_id = new.cooking_client_id and c.check_type = 'cooking';
      if other_site is distinct from new.site_id or cooked_ok is not true then
        raise exception 'Cooking check not found';
      end if;
      new.due_by := new.recorded_at + interval '2 hours';
    else
      new.due_by := null;
      select b.site_id into batch_site from public.hot_batch_logs b
        where b.client_id = new.batch_client_id and b.event = 'out';
      if batch_site is distinct from new.site_id then
        raise exception 'Batch not found';
      end if;
    end if;
  elsif tg_table_name = 'training_records' then
    select s.site_id into other_site from public.staff s where s.id = new.trainee_id;
    if other_site is distinct from new.site_id then
      raise exception 'Staff member belongs to a different store';
    end if;
    if new.certificate_path is not null and split_part(new.certificate_path, '/', 1) <> new.site_id::text then
      raise exception 'Certificate belongs to a different store';
    end if;
  elsif tg_table_name = 'health_logs' then
    select s.site_id into other_site from public.staff s where s.id = new.subject_id;
    if other_site is distinct from new.site_id then
      raise exception 'Staff member belongs to a different store';
    end if;
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;

-- Certificates: a private bucket, managers only, no overwrite or delete.
-- Guarded so the migration also runs where Storage isn't installed (tests).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('food-log-certificates', 'food-log-certificates', false, 10485760,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists food_log_certificates_read on storage.objects';
    execute 'drop policy if exists food_log_certificates_insert on storage.objects';
    execute $p$create policy food_log_certificates_read on storage.objects for select to authenticated
      using (bucket_id = 'food-log-certificates' and (select food_log_private.current_role()) = 'manager')$p$;
    execute $p$create policy food_log_certificates_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'food-log-certificates' and (select food_log_private.current_role()) = 'manager')$p$;
  end if;
end
$$;
