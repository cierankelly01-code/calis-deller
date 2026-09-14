-- Multi-store: every config row and every log row belongs to exactly one site.
-- Existing data is assigned to Stratford-upon-Avon (the original shop).
-- Log rows get their site from the staff member who recorded them — set by
-- the server-side stamp trigger, never trusted from the client — so a record
-- can never be filed under the wrong shop.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint food_log_site_name_length check (length(btrim(name)) between 1 and 200),
  constraint food_log_site_short_name_length check (length(btrim(short_name)) between 1 and 60),
  constraint food_log_site_slug check (slug ~ '^[a-z0-9-]{1,60}$')
);

insert into public.sites (slug, name, short_name, sort_order) values
  ('stratford',     'Kelly''s Deli — Stratford-upon-Avon', 'Stratford-upon-Avon', 1),
  ('bentley-heath', 'Kelly''s Deli — Bentley Heath',       'Bentley Heath',       2)
on conflict (slug) do nothing;

alter table public.sites enable row level security;
revoke all on public.sites from public, anon, authenticated;
grant select, insert, update on public.sites to authenticated;
create policy food_log_read on public.sites for select to authenticated
  using ((select food_log_private.current_role()) in ('staff','manager'));
create policy food_log_insert on public.sites for insert to authenticated
  with check ((select food_log_private.current_role()) = 'manager');
create policy food_log_update on public.sites for update to authenticated
  using ((select food_log_private.current_role()) = 'manager')
  with check ((select food_log_private.current_role()) = 'manager');
create trigger food_log_rate_limit before insert or update on public.sites
  for each row execute function food_log_private.limit_write();

-- site_id on every config + log table, backfilled to Stratford.
do $$
declare
  target_table text;
  stratford uuid := (select id from public.sites where slug = 'stratford');
begin
  foreach target_table in array array[
    'staff','fridge_units','suppliers','products','cleaning_tasks',
    'fridge_temp_logs','cooking_logs','delivery_logs','cleaning_logs','probe_calibration_logs'
  ] loop
    execute format('alter table public.%I add column if not exists site_id uuid references public.sites(id)', target_table);
    -- The write-limit trigger requires a signed-in food-log account; this
    -- one-off backfill runs from the SQL editor, so pause it for the update.
    execute format('alter table public.%I disable trigger food_log_rate_limit', target_table);
    execute format('update public.%I set site_id = %L where site_id is null', target_table, stratford);
    execute format('alter table public.%I enable trigger food_log_rate_limit', target_table);
    execute format('alter table public.%I alter column site_id set not null', target_table);
    execute format('create index if not exists %I on public.%I (site_id)', target_table || '_site_id_idx', target_table);
  end loop;
end
$$;

-- Server-derived site on log rows + cross-site guard. Replaces the stamp
-- trigger function from 20260908170550 (same trigger name, same tables).
create or replace function food_log_private.stamp_log()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare unit_site uuid; task_site uuid;
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
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;
