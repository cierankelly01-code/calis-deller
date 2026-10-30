-- Staff induction: each person reads the safe methods everyone must know and
-- confirms "I've read and understood this" on the iPad. One append-only row
-- per method per confirmation, recorded under the staff member's own name.
-- Not personal data beyond the name and time, so staff can read it too (the
-- home screen shows each person what's left to read).

create table if not exists public.induction_logs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  client_id uuid not null unique,
  staff_id uuid not null references public.staff(id),   -- the person who read it
  authenticated_user_id uuid references auth.users(id),
  method_id text not null check (method_id ~ '^[a-z0-9-]{1,60}$'),
  recorded_at timestamptz not null,
  synced_at timestamptz not null default now(),
  corrects_entry_id uuid references public.induction_logs(id),
  created_by_device text,
  constraint induction_device_length check (length(created_by_device) <= 2000),
  constraint food_log_device_time check (recorded_at <= synced_at + interval '5 minutes')
);
create index if not exists induction_logs_site_idx on public.induction_logs (site_id, staff_id);
create index if not exists induction_logs_user_idx on public.induction_logs (authenticated_user_id);

alter table public.induction_logs enable row level security;
revoke all on public.induction_logs from public, anon, authenticated;
grant select, insert on public.induction_logs to authenticated;
create policy food_log_read on public.induction_logs for select to authenticated
  using ((select food_log_private.current_role()) in ('staff', 'manager'));
create policy food_log_insert on public.induction_logs for insert to authenticated
  with check ((select food_log_private.current_role()) in ('staff', 'manager') and authenticated_user_id = (select auth.uid()));
-- stamp_log needs no new branch: it derives the shop from the staff member.
create trigger food_log_stamp before insert on public.induction_logs
  for each row execute function food_log_private.stamp_log();
create trigger food_log_rate_limit before insert or update on public.induction_logs
  for each row execute function food_log_private.limit_write();
