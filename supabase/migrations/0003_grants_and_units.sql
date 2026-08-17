-- Phase 3: table grants for the API roles + Kelly's Deli's real units.
--
-- Why this exists: 0001/0002 define RLS policies but never GRANT table
-- privileges, and this Supabase project has no default grants on the
-- public schema — so every API call fails with 42501 ("permission denied
-- for table ..."). Postgres checks grants BEFORE row-level security, and
-- both layers must allow an operation.
--
-- The grants below mirror the RLS intent exactly:
--   * Log tables are append-only evidence: SELECT + INSERT only.
--     UPDATE/DELETE is denied at BOTH the grant layer and the policy
--     layer — tamper-evidence is preserved.
--   * Config tables (soft-delete model) additionally allow UPDATE,
--     but never DELETE, so historic log rows always resolve their FKs.

grant usage on schema public to anon, authenticated;

-- Log tables: evidence. SELECT + INSERT only — no UPDATE, no DELETE.
grant select, insert on
  fridge_temp_logs,
  cooking_logs,
  delivery_logs,
  cleaning_logs,
  probe_calibration_logs
to anon, authenticated;

-- Config tables: soft-delete via UPDATE (active = false), never DELETE.
grant select, insert, update on
  staff,
  fridge_units,
  suppliers,
  products,
  cleaning_tasks
to anon, authenticated;

-- KELLY'S DELI REAL UNITS ----------------------------------------------
-- Idempotent by name: safe to re-run, and won't duplicate a unit that
-- was already added through the app. The generic seed fridges from
-- seed.sql are deactivated (soft-delete keeps any history resolvable);
-- the seeded 'Freezer' is the real freezer, so it's kept and re-ordered.

insert into fridge_units (name, unit_type, target_min_c, target_max_c, sort_order)
select v.name, v.unit_type, v.target_min_c, v.target_max_c, v.sort_order
from (values
  ('Cheese Fridge',      'fridge',    1.0,   5.0, 1),
  ('Cooked Meat Fridge', 'fridge',    1.0,   5.0, 2),
  ('Pastry Fridge',      'fridge',    1.0,   5.0, 3),
  ('Cake Fridge',        'fridge',    1.0,   5.0, 4),
  ('Back Fridge',        'fridge',    1.0,   5.0, 5),
  ('Freezer',            'freezer', -25.0, -18.0, 6)
) as v(name, unit_type, target_min_c, target_max_c, sort_order)
where not exists (
  select 1 from fridge_units u where u.name = v.name
);

update fridge_units set active = false
where name in ('Display Fridge', 'Walk-in Fridge') and active;

update fridge_units set sort_order = 6
where name = 'Freezer';
