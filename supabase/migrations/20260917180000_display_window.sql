-- The shop's own take-off time for sandwiches on top of the counter.
--
-- The law allows less than four hours; the shop runs three so the sandwiches
-- come off with an hour in hand and can go back in the fridge to be sold
-- chilled. Each put-out records the window it was put out under (in
-- minutes, default 180), the server derives off_by from it, and the legal
-- four-hour line is still checked by the app: under four hours, "back in
-- the fridge" is fine; over it, only the bin.

alter table public.ambient_display_logs
  add column if not exists display_minutes int;
alter table public.ambient_display_logs
  add constraint ambient_display_window check (
    display_minutes is null or (display_minutes between 30 and 240 and event = 'put_out')
  ) not valid;

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
  end if;
  return new;
end
$$;
revoke all on function food_log_private.stamp_log() from public, anon, authenticated;
