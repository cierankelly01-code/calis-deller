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

test('counter board derives open batches, bin-by dates, FIFO and customer advice',async()=>{
  const {openBatches,computeDiscardBy,summarise,customerAdvice,describeDaysLeft}=await import('../src/lib/counter/board.ts');
  // "3 days" = day opened + two more; a sooner pack use-by wins.
  assert.equal(computeDiscardBy(new Date('2026-09-14T09:00:00'),3,null),'2026-09-16');
  assert.equal(computeDiscardBy(new Date('2026-09-14T09:00:00'),3,'2026-09-15'),'2026-09-15');
  assert.equal(computeDiscardBy(new Date('2026-09-14T09:00:00'),3,'2026-09-20'),'2026-09-16');
  assert.equal(computeDiscardBy(new Date('2026-09-14T09:00:00'),1,null),'2026-09-14');

  const unit=randomUUID(),staff=randomUUID();
  const row=(over)=>({id:randomUUID(),client_id:randomUUID(),staff_id:staff,event:'put_out',batch_client_id:null,product_id:null,unit_id:unit,open_life_days:3,pack_use_by:null,discard_by:null,batch_code:null,reason:null,note:null,...over});
  const oldHam=row({product_name:'Ham',recorded_at:'2026-09-14T08:00:00.000Z',discard_by:'2026-09-16'});
  const newHam=row({product_name:'ham ',recorded_at:'2026-09-16T08:00:00.000Z',discard_by:'2026-09-18'});
  const pies=row({product_name:'Pork pies',recorded_at:'2026-09-12T08:00:00.000Z',discard_by:'2026-09-14'});
  const sold=row({product_name:'Turkey',recorded_at:'2026-09-15T08:00:00.000Z',discard_by:'2026-09-17'});
  const takenOff=row({event:'taken_off',batch_client_id:sold.client_id,product_name:'Turkey',recorded_at:'2026-09-16T12:00:00.000Z',open_life_days:null,reason:'sold_out'});
  const queued=row({product_name:'Coleslaw',recorded_at:'2026-09-16T07:00:00.000Z',open_life_days:2}); // discard_by not yet stamped by the server

  const batches=openBatches([takenOff,newHam,queued,sold,oldHam,pies],'2026-09-16');
  assert.deepEqual(batches.map(b=>b.productName),['Pork pies','Ham','Coleslaw','ham '],'soonest to bin first, sold-out batch gone');
  const byName=Object.fromEntries(batches.map(b=>[b.productName.trim().toLowerCase()+b.openedAt,b]));
  const old=byName['ham'+oldHam.recorded_at],fresh=byName['ham'+newHam.recorded_at];
  assert.equal(old.sellFirst,true,'older ham is the one to sell from');
  assert.equal(fresh.sellFirst,false);
  assert.equal(old.status,'today');assert.equal(old.daysLeft,0);
  assert.equal(customerAdvice(old.customerDays),'Use today','never tell a customer longer than the batch has left');
  assert.equal(fresh.status,'ok');assert.equal(customerAdvice(fresh.customerDays),'Use within 3 days');
  assert.equal(batches[0].status,'overdue');assert.equal(describeDaysLeft(batches[0].daysLeft),'2 days overdue');
  assert.equal(batches[2].discardBy,'2026-09-17','queued entry gets the same date the server will stamp');
  assert.deepEqual(summarise(batches),{open:4,dueToday:1,overdue:1});

  const {rotationStats}=await import('../src/lib/counter/board.ts');
  const lateBin=row({event:'taken_off',batch_client_id:pies.client_id,product_name:'Pork pies',recorded_at:'2026-09-16T09:00:00.000Z',open_life_days:null,reason:'end_of_life'});
  const inDateBin=row({event:'taken_off',batch_client_id:oldHam.client_id,product_name:'Ham',recorded_at:'2026-09-16T18:00:00.000Z',open_life_days:null,reason:'quality'});
  const ancient=row({product_name:'Old news',recorded_at:'2026-08-01T08:00:00.000Z',discard_by:'2026-08-03'});
  assert.deepEqual(rotationStats([takenOff,newHam,queued,sold,oldHam,pies,lateBin,inDateBin,ancient],'2026-09-16'),
    {days:28,putOut:5,soldOut:1,binnedInDate:1,binnedLate:1},'28-day prove-it numbers; late = taken off after its bin-by date');
});

test('counter entries are validated on the device like the database will',async()=>{
  const {validateWrite,canAccess}=await import('../src/lib/security/policy.ts');
  const base={client_id:randomUUID(),staff_id:randomUUID(),recorded_at:new Date().toISOString(),unit_id:randomUUID(),product_name:'Ham'};
  assert.equal(canAccess('staff','counter_stock_logs','POST'),true);
  assert.equal(canAccess('manager','counter_stock_logs','PATCH'),false);
  assert.ok(validateWrite('counter_stock_logs','POST',{...base,event:'put_out',open_life_days:3,pack_use_by:'2026-09-20',batch_code:null,product_id:null}));
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'put_out'}),/Invalid/,'put_out needs an open life');
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'put_out',open_life_days:3,discard_by:'2026-09-20'}),/Invalid/,'discard date is never client-supplied');
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'put_out',open_life_days:3,pack_use_by:'20/09/2026'}),/Invalid/);
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'put_out',open_life_days:3,reason:'sold_out'}),/Invalid/);
  assert.ok(validateWrite('counter_stock_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),reason:'sold_out',note:null}));
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'taken_off',reason:'sold_out'}),/Invalid/,'taken_off must name its batch');
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),reason:'other',note:' '}),/Say what happened/);
  assert.ok(validateWrite('counter_stock_logs','POST',{...base,event:'put_out',open_life_days:3,delivery_log_id:randomUUID()}));
  assert.throws(()=>validateWrite('counter_stock_logs','POST',{...base,event:'taken_off',batch_client_id:randomUUID(),reason:'sold_out',delivery_log_id:randomUUID()}),/Invalid/,'only a put_out links a delivery');
  assert.ok(validateWrite('products','PATCH',{open_life_days:2}));
  assert.ok(validateWrite('products','POST',{name:'Shared ham'}),'products need no shop');
  assert.throws(()=>validateWrite('products','POST',{name:'Pinned ham',site_id:randomUUID()}),/Invalid/,'a product can never be pinned to one shop');
  assert.throws(()=>validateWrite('products','PATCH',{open_life_days:0}));
});

test('Postgres derives the bin-by date, closes batches only against real ones and keeps the register append-only',async()=>{
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
    const migrate=async(filename)=>db.exec((await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
    for(const filename of ['0001_init.sql','0002_full_diary.sql','0003_grants_and_units.sql','20260908170550_food_log_security.sql','20260914090000_sites.sql','20260916120000_counter_stock.sql']) await migrate(filename);
    const [stratford,bentley]=(await db.query("select id from sites order by sort_order")).rows.map(r=>r.id);
    // Same product entered in both shops before the list was shared: the older
    // row survives, the copy is deactivated, and everything becomes shared.
    await db.exec('alter table products disable trigger food_log_rate_limit');
    await db.query("insert into products(name,site_id,created_at) values('Ham',$1,'2026-09-01'),('ham ',$2,'2026-09-17'),('Coleslaw',$2,'2026-09-17')",[stratford,bentley]);
    await db.exec('alter table products enable trigger food_log_rate_limit');
    await migrate('20260917100000_shared_products.sql');
    const products=(await db.query("select name,active,site_id from products where name in ('Ham','ham ','Coleslaw') order by name")).rows;
    assert.deepEqual(products,[{name:'Coleslaw',active:true,site_id:null},{name:'Ham',active:true,site_id:null},{name:'ham ',active:false,site_id:null}]);
    assert.equal((await db.query("select count(*)::int as n from cleaning_tasks where name like 'Counter stock%' and session='open'")).rows[0].n,2,'daily counter check seeded onto each shop opening list');
    assert.equal((await db.query("select count(*)::int as n from cleaning_tasks where name like 'Counter stock%' and session='close'")).rows[0].n,2,'and onto each closing list');
    // Sign in first: the write-limit trigger needs a food-log account even
    // for the fixture rows (inserted here as the owner, bypassing RLS).
    const user=randomUUID(),sessionId=randomUUID();
    await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[user,JSON.stringify({food_log_role:'staff'})]);
    await db.query('insert into auth.sessions values($1,$2)',[sessionId,user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[user,sessionId]);
    const staffId=randomUUID(),unitId=randomUUID(),otherUnit=randomUUID(),otherStaff=randomUUID();
    await db.query('insert into staff(id,name,site_id) values($1,$2,$3),($4,$5,$6)',[staffId,'Test Staff',stratford,otherStaff,'Other Shop',bentley]);
    await db.query("insert into fridge_units(id,name,unit_type,target_min_c,target_max_c,site_id) values($1,'Serve-over 1','fridge',1,5,$2),($3,'Other shop counter','fridge',1,5,$4)",[unitId,stratford,otherUnit,bentley]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int as n from products where active')).rows[0].n,(await db.query('select count(*)::int as n from products where active and site_id is null')).rows[0].n,'every active product is shared');

    const batch=randomUUID(),ownDelivery=randomUUID(),otherDelivery=randomUUID();
    await db.query("insert into delivery_logs(client_id,staff_id,supplier_name,accepted,recorded_at) values($1,$2,'Meat Supplier',true,now()),($3,$4,'Other Shop Supplier',true,now())",[ownDelivery,staffId,otherDelivery,otherStaff]);
    const [ownDeliveryId,otherDeliveryId]=(await db.query('select id from delivery_logs where client_id in ($1,$2) order by client_id=$1 desc',[ownDelivery,otherDelivery])).rows.map(r=>r.id);
    const insert=(values)=>db.query("insert into counter_stock_logs(client_id,staff_id,event,batch_client_id,product_name,unit_id,open_life_days,pack_use_by,reason,note,recorded_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",values);
    await db.query("insert into counter_stock_logs(client_id,staff_id,event,product_name,unit_id,open_life_days,delivery_log_id,recorded_at) values($1,$2,'put_out','Traced ham',$3,3,$4,now())",[randomUUID(),staffId,unitId,ownDeliveryId]);
    await assert.rejects(db.query("insert into counter_stock_logs(client_id,staff_id,event,product_name,unit_id,open_life_days,delivery_log_id,recorded_at) values($1,$2,'put_out','Traced ham',$3,3,$4,now())",[randomUUID(),staffId,unitId,otherDeliveryId]),/different store/,'cannot link another shop\u2019s delivery');
    await insert([batch,staffId,'put_out',null,'Ham',unitId,3,null,null,null,'2026-09-14T09:00:00Z']);
    let saved=(await db.query('select discard_by::text as discard_by,site_id from counter_stock_logs where client_id=$1',[batch])).rows[0];
    assert.equal(saved.discard_by,'2026-09-16','3 days including the day opened');
    assert.equal(saved.site_id,stratford,'site comes from the staff member');
    const shortPack=randomUUID();
    await insert([shortPack,staffId,'put_out',null,'Turkey',unitId,3,'2026-09-15',null,null,'2026-09-14T09:00:00Z']);
    assert.equal((await db.query('select discard_by::text as d from counter_stock_logs where client_id=$1',[shortPack])).rows[0].d,'2026-09-15','a sooner pack use-by wins');
    await assert.rejects(insert([randomUUID(),staffId,'put_out',null,'Ham',otherUnit,3,null,null,null,'2026-09-14T09:00:00Z']),/different store/);
    await assert.rejects(insert([randomUUID(),staffId,'put_out',null,'Ham',unitId,null,null,null,null,'2026-09-14T09:00:00Z']),/check constraint/,'open life required');
    await assert.rejects(insert([randomUUID(),staffId,'put_out',null,'Ham',unitId,3,null,'sold_out',null,'2026-09-14T09:00:00Z']),/check constraint/);
    await assert.rejects(insert([randomUUID(),staffId,'taken_off',randomUUID(),'Ham',unitId,null,null,'sold_out',null,'2026-09-16T09:00:00Z']),/Batch not found/);
    await assert.rejects(insert([randomUUID(),staffId,'taken_off',batch,'Ham',unitId,null,null,'other',null,'2026-09-16T09:00:00Z']),/check constraint/,'"other" needs a note');
    await insert([randomUUID(),staffId,'taken_off',batch,'Ham',unitId,null,null,'end_of_life',null,'2026-09-16T18:00:00Z']);
    await assert.rejects(db.query("update counter_stock_logs set discard_by='2030-01-01'"),/permission denied/);
    await assert.rejects(db.query('delete from counter_stock_logs'),/permission denied/);
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from counter_stock_logs'),/permission denied/);
  } finally {await db.close();}
});
