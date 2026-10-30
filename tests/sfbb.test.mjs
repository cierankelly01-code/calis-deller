import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/')?pathToFileURL(resolve('src',specifier.slice(2)+'.ts')).href:specifier,context);
}});

async function migratedDb() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,raw_app_meta_data jsonb,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert on storage.objects to authenticated;`);
  const files=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  for(const filename of files) {
    await db.exec((await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
  }
  return db;
}

test('Postgres: cooling clock, manager-only training and health, reviews, checks and certificates',async()=>{
  const db=await migratedDb();
  try {
    const [stratford,bentley]=(await db.query('select id from sites order by sort_order')).rows.map(r=>r.id);
    const manager=randomUUID(),staff=randomUUID(),sessionId=randomUUID();
    for(const [id,role] of [[manager,'manager'],[staff,'staff']]) await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[id,JSON.stringify({food_log_role:role})]);
    const simone=randomUUID(),fiona=randomUUID(),other=randomUUID();
    await asUser(manager);await db.exec('reset role'); // config writes pass the write limiter as a signed-in manager
    await db.query('insert into staff(id,name,site_id) values($1,$2,$3),($4,$5,$6),($7,$8,$9)',[simone,'Staff A',stratford,fiona,'Manager B',stratford,other,'Other shop',bentley]);
    async function asUser(id) {
      await db.exec('reset role');
      await db.query('delete from auth.sessions where id=$1',[sessionId]);
      await db.query('insert into auth.sessions values($1,$2)',[sessionId,id]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[id,sessionId]);
      await db.exec('set role authenticated');
    }
    const cook=(clientId,staffId,temp)=>db.query("insert into cooking_logs(client_id,staff_id,check_type,product_name,quantity,temp_c,in_range,corrective_action,recorded_at) values($1,$2,'cooking','Sausage rolls',20,$3,true,$4,'2026-10-30T09:00:00Z')",[clientId,staffId,temp,temp<75?'back in the oven':null]);
    const batch=(values)=>db.query('insert into hot_batch_logs(client_id,staff_id,event,batch_client_id,cooking_client_id,product_name,quantity,temp_c,outcome,recorded_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',values);

    await asUser(staff);
    const cooked=randomUUID(),underdone=randomUUID(),elsewhere=randomUUID();
    await cook(cooked,simone,82);await cook(underdone,simone,60);await cook(elsewhere,other,90);
    const out=randomUUID();
    await batch([out,simone,'out',null,cooked,'Sausage rolls',20,null,null,'2026-10-30T09:01:00Z']);
    const saved=(await db.query('select due_by,site_id from hot_batch_logs where client_id=$1',[out])).rows[0];
    assert.equal(new Date(saved.due_by).toISOString(),'2026-10-30T11:01:00.000Z','two hours from out of the oven, stamped by the server');
    assert.equal(saved.site_id,stratford);
    await assert.rejects(batch([randomUUID(),simone,'out',null,underdone,'Sausage rolls',20,null,null,'2026-10-30T09:01:00Z']),/Cooking check not found/,'no clock on an undercooked batch');
    await assert.rejects(batch([randomUUID(),simone,'out',null,elsewhere,'Sausage rolls',20,null,null,'2026-10-30T09:01:00Z']),/Cooking check not found/,'no clock on another shop’s cooking');
    await assert.rejects(batch([randomUUID(),simone,'out',null,randomUUID(),'Sausage rolls',20,null,null,'2026-10-30T09:01:00Z']),/Cooking check not found/);
    await batch([randomUUID(),simone,'probe',out,null,'Sausage rolls',null,41.5,null,'2026-10-30T09:30:00Z']);
    await assert.rejects(batch([randomUUID(),simone,'probe',out,null,'Sausage rolls',null,null,null,'2026-10-30T09:30:00Z']),/check constraint/,'a probe needs a temperature');
    await assert.rejects(batch([randomUUID(),other,'done',out,null,'Sausage rolls',0,null,'sold_out','2026-10-30T10:00:00Z']),/Batch not found/,'cannot close another shop’s batch');
    await batch([randomUUID(),simone,'done',out,null,'Sausage rolls',4,7.5,'chilled','2026-10-30T10:55:00Z']);
    await assert.rejects(db.query("update hot_batch_logs set due_by=now()"),/permission denied/);
    await assert.rejects(db.query('delete from hot_batch_logs'),/permission denied/);

    // Staff: can log checks, cannot write or read training/health, cannot sign methods.
    await db.query("insert into site_check_logs(client_id,staff_id,kind,ok,recorded_at) values($1,$2,'pest',true,now())",[randomUUID(),simone]);
    await assert.rejects(db.query("insert into site_check_logs(client_id,staff_id,kind,ok,recorded_at) values($1,$2,'hand_wash',false,now())",[randomUUID(),simone]),/check constraint/,'a failed check needs an action');
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,recorded_at) values($1,$2,$2,'method','hand-washing','2026-10-30',now())",[randomUUID(),simone]),/row-level security/);
    await assert.rejects(db.query("insert into method_records(client_id,staff_id,method_id,recorded_at) values($1,$2,'hand-washing',now())",[randomUUID(),simone]),/row-level security/);
    await assert.rejects(db.query("insert into food_log_contacts(name,site_id) values('Pest Co',$1)",[stratford]),/row-level security/);

    await asUser(manager);
    await db.query("insert into method_records(client_id,staff_id,method_id,our_way,recorded_at) values($1,$2,'hand-washing','Left side of the double sink is for hands only',now())",[randomUUID(),fiona]);
    await assert.rejects(db.query("insert into method_records(client_id,staff_id,method_id,recorded_at) values($1,$2,'Bad Id!',now())",[randomUUID(),fiona]),/check constraint/);
    const path=`${stratford}/${randomUUID()}.jpg`;
    await db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,expires_on,certificate_path,recorded_at) values($1,$2,$3,'certificate','Level 2 Food Hygiene','2026-01-10','2029-01-10',$4,now())",[randomUUID(),fiona,simone,path]);
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,recorded_at) values($1,$2,$3,'method','hand-washing','2026-10-30',now())",[randomUUID(),fiona,other]),/different store/,'cannot record training for another shop’s staff');
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,certificate_path,recorded_at) values($1,$2,$3,'certificate','L2','2026-01-10',$4,now())",[randomUUID(),fiona,simone,`${bentley}/${randomUUID()}.jpg`]),/different store/);
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,certificate_path,recorded_at) values($1,$2,$3,'certificate','L2','2026-01-10','../../etc/passwd',now())",[randomUUID(),fiona,simone]),/check constraint|different store/);
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,certificate_path,recorded_at) values($1,$2,$3,'certificate','L2','2026-01-10',$4,now())",[randomUUID(),fiona,simone,`${stratford}/../x.jpg`]),/check constraint/,'only a plain uuid file name in the shop folder');
    await assert.rejects(db.query("insert into training_records(client_id,staff_id,trainee_id,kind,topic,trained_on,expires_on,recorded_at) values($1,$2,$3,'certificate','L2','2026-01-10','2025-01-10',now())",[randomUUID(),fiona,simone]),/check constraint/);
    await db.query("insert into health_logs(client_id,staff_id,subject_id,event,recorded_at) values($1,$2,$3,'sent_home',now())",[randomUUID(),fiona,simone]);
    await assert.rejects(db.query("insert into health_logs(client_id,staff_id,subject_id,event,recorded_at) values($1,$2,$3,'cleared',now())",[randomUUID(),fiona,simone]),/check constraint/,'cleared only after 48 hours free of symptoms');
    await db.query("insert into health_logs(client_id,staff_id,subject_id,event,symptom_free_48h,recorded_at) values($1,$2,$3,'cleared',true,now())",[randomUUID(),fiona,simone]);
    await db.query("insert into review_logs(client_id,staff_id,changes,all_ok,recorded_at) values($1,$2,'{suppliers}',true,now())",[randomUUID(),fiona]);
    await assert.rejects(db.query("insert into review_logs(client_id,staff_id,all_ok,recorded_at) values($1,$2,false,now())",[randomUUID(),fiona]),/check constraint/,'a review with problems must say what they were');
    await assert.rejects(db.query("insert into review_logs(client_id,staff_id,changes,all_ok,recorded_at) values($1,$2,'{weather}',true,now())",[randomUUID(),fiona]),/check constraint/);
    await db.query("insert into food_log_contacts(name,role,phone,site_id) values('Pest Co','Pest control','01789 000000',$1)",[stratford]);
    await assert.rejects(db.query("insert into food_log_contacts(name,phone,site_id) values('X','call me <script>',$1)",[stratford]),/check constraint/);
    await assert.rejects(db.query('update training_records set expires_on=null'),/permission denied/);
    await db.query("insert into storage.objects(bucket_id,name) values('food-log-certificates',$1)",[path]);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,1,'manager sees certificates');

    await asUser(staff);
    assert.equal((await db.query('select count(*)::int n from training_records')).rows[0].n,0,'staff cannot read training records');
    assert.equal((await db.query('select count(*)::int n from health_logs')).rows[0].n,0,'staff cannot read health records');
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,0,'staff cannot see certificates');
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('food-log-certificates','x')"),/row-level security/);
    assert.equal((await db.query('select count(*)::int n from method_records')).rows[0].n,1,'staff can read signed-off methods');
    assert.equal((await db.query('select count(*)::int n from review_logs')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from food_log_contacts')).rows[0].n,1);
    await db.exec('reset role');
    const bucket=(await db.query("select public from storage.buckets where id='food-log-certificates'")).rows[0];
    assert.equal(bucket.public,false,'the certificate bucket is private');
  } finally {await db.close();}
});
