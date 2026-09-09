import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Postgres migration enforces roles, immutable logs, validation, attribution and shared write limits',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key,raw_app_meta_data jsonb,is_anonymous boolean default false);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
    for(const filename of ['0001_init.sql','0002_full_diary.sql','0003_grants_and_units.sql']) {
      const sql=(await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
      await db.exec(sql);
    }
    const staffId=randomUUID(),unitId=randomUUID(),oldId=randomUUID();
    await db.query('insert into staff(id,name) values($1,$2)',[staffId,'Test Staff']);
    await db.query("insert into fridge_units(id,name,unit_type,target_min_c,target_max_c) values($1,'Test fridge','fridge',1,5)",[unitId]);
    await db.query("insert into fridge_temp_logs(client_id,staff_id,unit_id,period,reading_c,in_range,recorded_at) values($1,$2,$3,'am',3,true,now())",[oldId,staffId,unitId]);
    await db.exec(await readFile(new URL('../supabase/migrations/20260908170550_food_log_security.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select count(*)::int as n from fridge_temp_logs')).rows[0].n,1,'legacy evidence survives');
    const manager=randomUUID(),staff=randomUUID(),outsider=randomUUID(),sessionId=randomUUID();
    for(const [id,role] of [[manager,'manager'],[staff,'staff'],[outsider,null]]) {
      await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[id,JSON.stringify({food_log_role:role})]);
    }
    async function asUser(id) {
      await db.exec('reset role');
      await db.query('delete from auth.sessions where id=$1',[sessionId]);
      await db.query('insert into auth.sessions values($1,$2)',[sessionId,id]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[id,sessionId]);
      await db.exec('set role authenticated');
    }
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from staff'),/permission denied/);
    await assert.rejects(db.query("insert into staff(name) values('Intruder')"),/permission denied/);
    await asUser(outsider);
    assert.equal((await db.query('select * from staff')).rows.length,0);
    await assert.rejects(db.query("insert into staff(name) values('Intruder')"));
    await asUser(staff);
    assert.equal((await db.query('select * from staff')).rows.length,1);
    await assert.rejects(db.query("insert into staff(name) values('Not allowed')"));
    assert.equal((await db.query("update staff set name='Tampered' returning id")).rows.length,0);
    const entry=randomUUID();
    await db.query("insert into fridge_temp_logs(client_id,staff_id,unit_id,period,reading_c,in_range,recorded_at,authenticated_user_id) values($1,$2,$3,'am',3,false,now(),$4)",[entry,staffId,unitId,manager]);
    const saved=(await db.query('select in_range,authenticated_user_id from fridge_temp_logs where client_id=$1',[entry])).rows[0];
    assert.equal(saved.authenticated_user_id,staff,'cannot impersonate account');
    assert.equal(saved.in_range,true,'server calculates pass/fail');
    await assert.rejects(db.query("insert into fridge_temp_logs(client_id,staff_id,unit_id,period,reading_c,in_range,recorded_at) values($1,$2,$3,'am',99,true,now())",[randomUUID(),staffId,unitId]));
    await assert.rejects(db.query("insert into fridge_temp_logs(client_id,staff_id,unit_id,period,reading_c,in_range,recorded_at) values($1,$2,$3,'am',3,true,now())",[entry,staffId,unitId]),/duplicate key/);
    await asUser(manager);
    await db.query("insert into staff(name) values('New colleague')");
    assert.equal((await db.query("update staff set name='Edited' where id=$1 returning id",[staffId])).rows.length,1);
    await assert.rejects(db.query('update fridge_temp_logs set reading_c=4'),/permission denied/);
    await assert.rejects(db.query('delete from fridge_temp_logs'),/permission denied/);
    await assert.rejects(db.query('delete from staff'),/permission denied/);
    await assert.rejects(db.query("insert into staff(name) values('')"),/check constraint/);
    await assert.rejects(db.query("insert into cooking_logs(client_id,staff_id,product_name,temp_c,in_range,recorded_at,quantity) values($1,$2,'Food',80,true,now(),-1)",[randomUUID(),staffId]),/check constraint/);
    await db.exec('reset role');
    await db.query('update food_log_private.write_limits set requests=300 where user_id=$1',[manager]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query("insert into staff(name) values('Over quota')"),/Write limit reached/);
    await db.exec('reset role');
    await db.query("update food_log_private.write_limits set window_start=now()-interval '2 minutes' where user_id=$1",[manager]);
    await db.exec('set role authenticated');
    await db.query("insert into staff(name) values('After reset')");
    await db.exec('reset role');
    await db.query("update auth.users set raw_app_meta_data='{}' where id=$1",[manager]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from staff')).rows.length,0,'role revocation is immediate');
    await asUser(staff);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1',[sessionId]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from staff')).rows.length,0,'sign-out invalidates database access');
  } finally {await db.close();}
});
