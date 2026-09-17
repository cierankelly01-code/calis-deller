import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/')?pathToFileURL(resolve('src',specifier.slice(2)+'.ts')).href:specifier,context);
}});

test('sandwich board: four-hour timers, fridge reserve, once-only returns and staged alerts',async()=>{
  const {outNow,fridgeReserve,chilledReturns,summariseAmbient,dueAlerts,describeRemaining,computeOffBy}=await import('../src/lib/ambient/board.ts');
  const staff=randomUUID();
  const row=(over)=>({id:randomUUID(),client_id:randomUUID(),staff_id:staff,event:'made',batch_client_id:null,product_id:null,quantity:1,off_by:null,outcome:null,note:null,...over});
  const today=new Date();today.setHours(7,0,0,0);
  const at=(h,m)=>{const d=new Date(today);d.setHours(h,m,0,0);return d.toISOString();};
  assert.equal(computeOffBy(new Date(at(8,0))),at(12,0));

  const made=[row({product_name:'Ham Salad',quantity:2,recorded_at:at(7,0)}),row({product_name:'Cheese & Onion',quantity:2,recorded_at:at(7,0)}),row({product_name:'Coronation Chicken',quantity:1,recorded_at:at(7,5)})];
  const out1=row({event:'put_out',product_name:'Ham Salad',quantity:1,recorded_at:at(8,0),off_by:at(12,0)});
  const out2=row({event:'put_out',product_name:'cheese & onion ',quantity:1,recorded_at:at(8,0)}); // off_by not stamped yet (queued offline)
  const sold=row({event:'taken_off',batch_client_id:out1.client_id,product_name:'Ham Salad',quantity:0,outcome:'sold_out',recorded_at:at(11,0)});
  const out3=row({event:'put_out',product_name:'Ham Salad',quantity:1,recorded_at:at(11,5),off_by:at(15,5)});
  const back=row({event:'taken_off',batch_client_id:randomUUID(),product_name:'Turkey Salad',quantity:2,outcome:'chilled',recorded_at:at(10,0)});
  const logs=[...made,out1,out2,sold,out3,back];

  const now=new Date(at(11,45)).getTime();
  const groups=outNow(logs,now);
  assert.deepEqual(groups.map(g=>[g.outAt,g.quantity,g.status]),[[at(8,0),1,'soon'],[at(11,5),1,'ok']],'sold batch gone; 08:00 group has only the cheese left and is inside 30 minutes');
  assert.equal(groups[0].offBy,at(12,0),'queued put-out gets the same deadline the server will stamp');
  assert.equal(describeRemaining(groups[0].msLeft),'15m left');
  assert.equal(describeRemaining(new Date(at(12,7)).getTime()-now),'22m left');
  assert.equal(describeRemaining(-5*60_000),'Over by 5m — bin them');
  assert.equal(describeRemaining(3*3600_000+2*60_000),'3h 02m left');

  const reserve=fridgeReserve(logs,today.toISOString().slice(0,10));
  assert.deepEqual(reserve.map(r=>[r.productName,r.quantity]),[['Cheese & Onion',1],['Coronation Chicken',1]],'made minus put out, per product, case-insensitive; chilled returns never come back into the reserve');
  assert.deepEqual(chilledReturns(logs,today.toISOString().slice(0,10)).map(r=>[r.productName,r.quantity]),[['Turkey Salad',2]]);
  assert.deepEqual(summariseAmbient(groups,reserve),{out:2,groups:2,soonestMsLeft:15*60_000,overdue:0,inFridge:2});

  const fired=new Set();
  assert.deepEqual(dueAlerts(groups,fired).map(a=>a.key),[`${at(8,0)}:30m`],'inside 30 minutes: the first warning is due');
  for(const a of dueAlerts(groups,fired))fired.add(a.key);
  assert.deepEqual(dueAlerts(groups,fired),[],'never twice');
  const later=outNow(logs,new Date(at(12,1)).getTime());
  assert.equal(later[0].status,'overdue');
  assert.deepEqual(dueAlerts(later,fired).map(a=>a.key),[`${at(8,0)}:10m`,`${at(8,0)}:due`],'missed stages catch up, then the deadline itself');
});

test('sandwich entries are validated on the device like the database will',async()=>{
  const {validateWrite}=await import('../src/lib/security/policy.ts');
  const base={client_id:randomUUID(),staff_id:randomUUID(),recorded_at:new Date().toISOString(),product_name:'Ham Salad'};
  assert.ok(validateWrite('ambient_display_logs','POST',{...base,event:'made',quantity:6}));
  assert.ok(validateWrite('ambient_display_logs','POST',{...base,event:'put_out',quantity:1,product_id:null}));
  assert.throws(()=>validateWrite('ambient_display_logs','POST',{...base,event:'put_out',quantity:0}),/Invalid/,'nothing out is not a put-out');
  assert.throws(()=>validateWrite('ambient_display_logs','POST',{...base,event:'put_out',quantity:1,off_by:new Date().toISOString()}),/Invalid/,'the deadline is never client-supplied');
  assert.throws(()=>validateWrite('ambient_display_logs','POST',{...base,event:'put_out',quantity:1,outcome:'sold_out'}),/Invalid/);
  assert.ok(validateWrite('ambient_display_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),quantity:0,outcome:'sold_out'}));
  assert.ok(validateWrite('ambient_display_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),quantity:2,outcome:'chilled'}));
  assert.throws(()=>validateWrite('ambient_display_logs','POST',{...base,event:'taken_off',quantity:0,outcome:'sold_out'}),/Invalid/,'taken_off must name its batch');
  assert.throws(()=>validateWrite('ambient_display_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),quantity:0}),/Invalid/,'taken_off needs an outcome');
  assert.ok(validateWrite('products','PATCH',{category:'sandwich'}));
  assert.throws(()=>validateWrite('products','PATCH',{category:'cake'}));
});

test('Postgres stamps the four-hour deadline, guards take-offs and seeds the line-up as shared sandwiches',async()=>{
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
    for(const filename of ['0001_init.sql','0002_full_diary.sql','0003_grants_and_units.sql','20260908170550_food_log_security.sql','20260914090000_sites.sql','20260916120000_counter_stock.sql','20260917100000_shared_products.sql','20260917140000_ambient_display.sql']) {
      await db.exec((await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
    }
    const seeded=(await db.query("select name,category,site_id,allergens from products where category='sandwich' order by name")).rows;
    assert.deepEqual(seeded.map(r=>[r.name,r.site_id]),[['Cheese & Onion',null],['Ham & Cheese',null],['Ham Salad',null],['Turkey Salad',null]],'line-up seeded once, shared by both shops');
    assert.deepEqual(seeded.find(r=>r.name==='Ham & Cheese').allergens,['gluten','milk']);
    const [stratford,bentley]=(await db.query("select id from sites order by sort_order")).rows.map(r=>r.id);
    const user=randomUUID(),sessionId=randomUUID();
    await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[user,JSON.stringify({food_log_role:'staff'})]);
    await db.query('insert into auth.sessions values($1,$2)',[sessionId,user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[user,sessionId]);
    const staffId=randomUUID(),otherStaff=randomUUID();
    await db.query('insert into staff(id,name,site_id) values($1,$2,$3),($4,$5,$6)',[staffId,'Test Staff',stratford,otherStaff,'Other Shop',bentley]);
    await db.exec('set role authenticated');

    const insert=(values)=>db.query("insert into ambient_display_logs(client_id,staff_id,event,batch_client_id,product_name,quantity,outcome,recorded_at) values($1,$2,$3,$4,$5,$6,$7,$8)",values);
    const batch=randomUUID(),otherBatch=randomUUID();
    await insert([randomUUID(),staffId,'made',null,'Ham Salad',6,null,'2026-09-16T06:00:00Z']);
    await insert([batch,staffId,'put_out',null,'Ham Salad',1,null,'2026-09-16T07:00:00Z']);
    await insert([otherBatch,otherStaff,'put_out',null,'Ham Salad',1,null,'2026-09-16T07:00:00Z']);
    const saved=(await db.query('select off_by,site_id from ambient_display_logs where client_id=$1',[batch])).rows[0];
    assert.equal(new Date(saved.off_by).toISOString(),'2026-09-16T11:00:00.000Z','four hours from going out, stamped by the server');
    assert.equal(saved.site_id,stratford);
    assert.equal((await db.query('select off_by from ambient_display_logs where event=$1',['made'])).rows[0].off_by,null,'only a put-out has a deadline');
    await assert.rejects(insert([randomUUID(),staffId,'put_out',null,'Ham Salad',0,null,'2026-09-16T07:00:00Z']),/check constraint/);
    await assert.rejects(insert([randomUUID(),staffId,'taken_off',randomUUID(),'Ham Salad',0,'sold_out','2026-09-16T10:00:00Z']),/Batch not found/);
    await assert.rejects(insert([randomUUID(),staffId,'taken_off',otherBatch,'Ham Salad',0,'sold_out','2026-09-16T10:00:00Z']),/Batch not found/,'cannot close another shop\\u2019s batch');
    await assert.rejects(insert([randomUUID(),staffId,'taken_off',batch,'Ham Salad',0,null,'2026-09-16T10:00:00Z']),/check constraint/,'outcome required');
    await insert([randomUUID(),staffId,'taken_off',batch,'Ham Salad',1,'chilled','2026-09-16T10:30:00Z']);
    await assert.rejects(db.query("update ambient_display_logs set off_by=now()+interval '1 day'"),/permission denied/);
    await assert.rejects(db.query('delete from ambient_display_logs'),/permission denied/);
  } finally {await db.close();}
});
