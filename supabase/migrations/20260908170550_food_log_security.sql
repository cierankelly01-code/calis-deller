-- Deploy together with the authenticated app and provisioned food-log accounts.
-- Scoped to these ten tables: this project also hosts an unrelated website.
-- Existing records are preserved. NOT VALID constraints enforce future writes
-- without rejecting the migration because of legacy data.
create schema if not exists food_log_private;
revoke all on schema food_log_private from public, anon;
grant usage on schema food_log_private to authenticated;

-- Read the current server-managed role, not user-editable JWT metadata.
-- Checking auth.sessions also invalidates access after sign-out/revocation.
create or replace function food_log_private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select u.raw_app_meta_data ->> 'food_log_role'
  from auth.users u
  where u.id = (select auth.uid())
    and not coalesce(u.is_anonymous, false)
    and u.raw_app_meta_data ->> 'food_log_role' in ('staff', 'manager')
    and exists (
      select 1 from auth.sessions s where s.user_id = u.id
      and s.id::text = (select auth.jwt() ->> 'session_id')
    )
$$;
revoke all on function food_log_private.current_role() from public, anon;
grant execute on function food_log_private.current_role() to authenticated;

create table food_log_private.write_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null
);
alter table food_log_private.write_limits enable row level security;
revoke all on food_log_private.write_limits from public, anon, authenticated;

create function food_log_private.limit_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare request_count integer;
begin
  if auth.uid() is null or food_log_private.current_role() is null then
    raise insufficient_privilege using message = 'Food log account required';
  end if;
  insert into food_log_private.write_limits as counters (user_id, window_start, requests)
  values (auth.uid(), clock_timestamp(), 1)
  on conflict (user_id) do update set
    window_start = case when counters.window_start < clock_timestamp() - interval '1 minute' then clock_timestamp() else counters.window_start end,
    requests = case when counters.window_start < clock_timestamp() - interval '1 minute' then 1 else counters.requests + 1 end
  where counters.window_start < clock_timestamp() - interval '1 minute' or counters.requests < 300
  returning requests into request_count;
  if request_count is null then raise exception 'Write limit reached'; end if;
  return new;
end
$$;
revoke all on function food_log_private.limit_write() from public, anon, authenticated;

create function food_log_private.stamp_log()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.authenticated_user_id := auth.uid();
  new.synced_at := clock_timestamp();
  if tg_table_name = 'fridge_temp_logs' then
    select new.reading_c between u.target_min_c and u.target_max_c into new.in_range
    from public.fridge_units u where u.id = new.unit_id;
  elsif tg_table_name = 'cooking_logs' then
    new.in_range := new.temp_c >= case when new.check_type = 'hot_hold' then 63 else 75 end;
  elsif tg_table_name = 'probe_calibration_logs' then
    new.pass := abs(new.reading_c - case when new.method = 'ice' then 0 else 100 end) <= 1;
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;

do $$
declare
  target_table text;
  policy record;
  column_name text;
  config_tables text[] := array['staff','fridge_units','suppliers','products','cleaning_tasks'];
  log_tables text[] := array['fridge_temp_logs','cooking_logs','delivery_logs','cleaning_logs','probe_calibration_logs'];
begin
  foreach target_table in array config_tables || log_tables loop
    execute format('alter table public.%I enable row level security', target_table);
    -- Remove all preexisting policies on these specific tables, including
    -- live-only admin ALL policies that would bypass append-only protection.
    for policy in select policyname from pg_policies where schemaname='public' and tablename=target_table loop
      execute format('drop policy %I on public.%I', policy.policyname, target_table);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', target_table);
    execute format('grant select, insert on public.%I to authenticated', target_table);
    execute format('create policy food_log_read on public.%I for select to authenticated using ((select food_log_private.current_role()) in (''staff'',''manager''))', target_table);
    if target_table = any(config_tables) then
      execute format('grant update on public.%I to authenticated', target_table);
      execute format('create policy food_log_insert on public.%I for insert to authenticated with check ((select food_log_private.current_role()) = ''manager'')', target_table);
      execute format('create policy food_log_update on public.%I for update to authenticated using ((select food_log_private.current_role()) = ''manager'') with check ((select food_log_private.current_role()) = ''manager'')', target_table);
      execute format('alter table public.%I add constraint food_log_name_length check (length(btrim(name)) between 1 and 200) not valid', target_table);
    else
      execute format('alter table public.%I add column authenticated_user_id uuid references auth.users(id)', target_table);
      execute format('create index on public.%I (authenticated_user_id)', target_table);
      execute format('create policy food_log_insert on public.%I for insert to authenticated with check ((select food_log_private.current_role()) in (''staff'',''manager'') and authenticated_user_id = (select auth.uid()))', target_table);
      execute format('create trigger food_log_stamp before insert on public.%I for each row execute function food_log_private.stamp_log()', target_table);
      execute format('alter table public.%I add constraint food_log_device_time check (recorded_at <= synced_at + interval ''5 minutes'') not valid', target_table);
    end if;
    execute format('create trigger food_log_rate_limit before insert or update on public.%I for each row execute function food_log_private.limit_write()', target_table);
    for column_name in select c.column_name from information_schema.columns c where c.table_schema='public' and c.table_name=target_table and c.data_type='text' loop
      execute format('alter table public.%I add constraint %I check (length(%I) <= 2000) not valid',target_table,'food_log_length_'||column_name,column_name);
    end loop;
  end loop;
end
$$;

alter table public.fridge_units add constraint food_log_temperature_band check (target_min_c >= -100 and target_max_c <= 300 and target_min_c < target_max_c) not valid;
alter table public.fridge_temp_logs add constraint food_log_reading check (reading_c between -100 and 300 and (in_range or coalesce(length(btrim(corrective_action)),0) > 0)) not valid;
alter table public.cooking_logs add constraint food_log_cooking_values check (quantity between 1 and 10000 and temp_c between -100 and 300 and length(btrim(product_name)) between 1 and 200 and (in_range or coalesce(length(btrim(corrective_action)),0) > 0)) not valid;
alter table public.delivery_logs add constraint food_log_delivery_values check (length(btrim(supplier_name)) between 1 and 200 and (accepted or coalesce(length(btrim(rejection_reason)),0) > 0) and (vehicle_temp_c is null or vehicle_temp_c between -100 and 300) and (chilled_temp_c is null or chilled_temp_c between -100 and 300) and (frozen_temp_c is null or frozen_temp_c between -100 and 300)) not valid;
alter table public.probe_calibration_logs add constraint food_log_probe_values check (reading_c between -100 and 300 and (pass or coalesce(length(btrim(corrective_action)),0) > 0)) not valid;

