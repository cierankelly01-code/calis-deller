-- One product list for both shops. Both sell the same range, so an allergen
-- edit made in Bentley Heath must show in Stratford-upon-Avon and vice
-- versa. A product with site_id = null is shared; the app no longer sends
-- site_id for products at all, and reads every active product regardless of
-- the selected shop. Staff, fridges, suppliers, cleaning tasks and every log
-- table stay per-shop — only the product/allergen list is pooled.
--
-- Existing rows: if the same product name was entered (or copied) in both
-- shops, the older row is kept and the newer one deactivated (soft-delete,
-- so any cooking log that referenced it still resolves). Everything active
-- is then made shared.

alter table public.products alter column site_id drop not null;

-- The write-limit trigger requires a signed-in food-log account; this runs
-- from the SQL editor, so pause it for the backfill.
alter table public.products disable trigger food_log_rate_limit;

update public.products p
set active = false, updated_at = now()
where p.active
  and exists (
    select 1 from public.products older
    where older.active
      and older.id <> p.id
      and lower(btrim(older.name)) = lower(btrim(p.name))
      and older.site_id is distinct from p.site_id
      and (older.created_at, older.id) < (p.created_at, p.id)
  );

update public.products set site_id = null where site_id is not null;

alter table public.products enable trigger food_log_rate_limit;
