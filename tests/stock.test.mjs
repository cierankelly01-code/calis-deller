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

const ham=randomUUID(),pies=randomUUID();
const count=(product_id,product_name,unit,business_date,came_in,binned,on_hand,time='18:00')=>({id:randomUUID(),client_id:randomUUID(),staff_id:randomUUID(),event:'count',product_id,product_name,unit,came_in,binned,on_hand,tags:[],note:null,business_date,recorded_at:`${business_date}T${time}:00.000Z`});
const soldOut=(product_id,product_name,business_date,time)=>({...count(product_id,product_name,null,business_date,null,null,null,time),event:'sold_out'});
const dayNote=(business_date,tags,note,time='18:05')=>({...count(null,null,null,business_date,null,null,null,time),event:'day_note',tags,note});

test('sold = last count + came in − binned − left, latest recount wins, gaps and impossible figures are flagged',async()=>{
  const {saleDays,weekReport,weekStart,lastCountsBefore,supplierSpend,formatQty,formatMoney}=await import('../src/lib/stock/ledger.ts');
  assert.equal(weekStart('2026-09-30'),'2026-09-28','weeks start on Monday');
  assert.equal(weekStart('2026-09-27'),'2026-09-21','Sunday belongs to the week before');
  const logs=[
    // Previous week (baseline on the Sunday before): 30 sold.
    count(pies,'Pork pie','each','2026-09-20',0,0,10),
    count(pies,'Pork pie','each','2026-09-21',20,0,10),
    count(pies,'Pork pie','each','2026-09-27',0,0,0),
    // This week.
    count(pies,'Pork pie','each','2026-09-28',24,2,20),   // 0 + 24 − 2 − 20 = 2 sold Mon
    count(pies,'Pork pie','each','2026-09-29',0,0,5),     // 15 sold Tue…
    count(pies,'Pork pie','each','2026-09-29',0,0,6,'19:00'), // …recount: 14
    count(pies,'Pork pie','each','2026-10-01',12,0,10),   // Wed missed: Thu covers two days, 8 sold
    count(pies,'Pork pie','each','2026-10-02',0,0,12),    // Fri: more left than yesterday, no delivery → −2
    count(ham,'Ham','kg','2026-09-28',5,0,4.2),
    count(ham,'Ham','kg','2026-09-29',0,0.3,2.65),       // 4.2 − 0.3 − 2.65 = 1.25 kg
    soldOut(pies,'Pork pie','2026-09-29','12:40'),
    soldOut(pies,'Pork pie','2026-09-29','11:15'),
    dayNote('2026-09-29',['rain','quiet'],'Roadworks outside'),
    dayNote('2026-09-29',['rain'],null,'19:30'),
  ];
  const days=saleDays(logs);
  const piesWeek=days.filter(d=>d.key===pies&&d.date>='2026-09-28');
  assert.deepEqual(piesWeek.map(d=>[d.date,d.sold,d.spanDays]),[['2026-09-28',2,1],['2026-09-29',14,1],['2026-10-01',8,2],['2026-10-02',-2,1]]);
  assert.equal(days.find(d=>d.key===ham&&d.date==='2026-09-29').sold,1.25,'kg to the gram, no float noise');

  const prices=new Map([[pies,{cost:0.8,sell:2.2}],[ham,{cost:9,sell:18}]]);
  const week=weekReport(logs,prices,'2026-09-28');
  assert.equal(week.to,'2026-10-04');
  const p=week.products.find(x=>x.key===pies),h=week.products.find(x=>x.key===ham);
  assert.equal(p.sold,24,'the impossible −2 is left out of the total');
  assert.equal(p.revenue,52.8);assert.equal(p.profit,33.6);assert.equal(p.margin,64);
  assert.equal(p.binned,2);assert.equal(p.wasteCost,1.6);
  assert.deepEqual(p.byWeekday,[2,14,null,null,null,null,null],'only one-night figures go on the day grid');
  assert.deepEqual(p.soldOuts,[{date:'2026-09-29',time:new Date('2026-09-29T11:15:00.000Z').toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}],'earliest sell-out per day');
  assert.equal(p.prevWeeksAvg,30,'average of the earlier weeks that had counts');
  assert.equal(p.checks.length,2);
  assert.match(p.checks[0],/covers 2 days/);assert.match(p.checks[1],/Fri: -2 sold/);
  assert.equal(h.sold,1.25);assert.equal(h.revenue,22.5);assert.equal(h.profit,11.25);assert.equal(h.wasteCost,2.7);
  assert.equal(h.prevWeeksAvg,null);
  assert.deepEqual(week.products.map(x=>x.productName),['Pork pie','Ham'],'best profit first');
  assert.deepEqual(week.totals,{revenue:75.3,cost:30.45,profit:44.85,wasteCost:4.3});
  assert.deepEqual(week.countDays,['2026-09-28','2026-09-29','2026-10-01','2026-10-02']);
  assert.deepEqual(week.notes,[{date:'2026-09-29',tags:['rain'],note:null}],'latest note for the day wins');

  const soFar=weekReport(logs,prices,'2026-09-28','2026-09-29');
  assert.equal(soFar.through,'2026-09-29');assert.equal(week.through,'2026-10-04');
  assert.equal(soFar.products.find(x=>x.key===pies).prevWeeksAvg,20,'a week in progress is compared with the same days of earlier weeks, not whole weeks');

  const unpriced=weekReport(logs,new Map(),'2026-09-28');
  assert.deepEqual(unpriced.unpriced.sort(),['Ham','Pork pie']);
  assert.equal(unpriced.products[0].revenue,null);

  const last=lastCountsBefore(logs,'2026-09-29');
  assert.equal(last.get(pies).on_hand,20);assert.equal(last.get(ham).on_hand,4.2);

  assert.deepEqual(supplierSpend([
    {supplier_name:'Scrivens',invoice_total:125,recorded_at:'2026-09-28T09:00:00Z',accepted:true},
    {supplier_name:'scrivens ',invoice_total:80.5,recorded_at:'2026-10-01T09:00:00Z',accepted:true},
    {supplier_name:'Scrivens',invoice_total:99,recorded_at:'2026-10-01T09:00:00Z',accepted:false},
    {supplier_name:'Bakery',invoice_total:null,recorded_at:'2026-10-01T09:00:00Z',accepted:true},
    {supplier_name:'Scrivens',invoice_total:40,recorded_at:'2026-10-06T09:00:00Z',accepted:true},
  ],'2026-09-28'),[{supplier:'Scrivens',total:205.5,deliveries:2}],'rejected deliveries and other weeks left out');
  assert.equal(formatQty(1.25,'kg'),'1.25 kg');assert.equal(formatQty(12,'each'),'12');assert.equal(formatMoney(-3),'−£3.00');
});

test('the weekly prompt carries the numbers, the context and the questions — and no staff names',async()=>{
  const {weekReport}=await import('../src/lib/stock/ledger.ts');
  const {buildSummaryPrompt}=await import('../src/lib/stock/prompt.ts');
  const logs=[count(pies,'Pork pie','each','2026-09-27',0,0,10),count(pies,'Pork pie','each','2026-09-28',24,2,20),soldOut(pies,'Pork | pie','2026-09-28','12:00'),dayNote('2026-09-28',['busy'],'Market day')];
  const report=weekReport(logs,new Map([[pies,{cost:0.8,sell:2.2}]]),'2026-09-28');
  const prompt=buildSummaryPrompt([{shopName:'Stratford-upon-Avon',report,spend:[{supplier:'Scrivens',total:125,deliveries:1}]},{shopName:'Bentley Heath',report:weekReport([],new Map(),'2026-09-28'),spend:[]}]);
  assert.match(prompt,/Kelly's Deli, a deli with 2 shops \(Stratford-upon-Avon and Bentley Heath\)/);
  assert.match(prompt,/\| Pork pie \| 12 \| £26\.40 \| £16\.80 \| 64% \| 2 \| £1\.60 \| Mon/);
  assert.match(prompt,/Scrivens £125\.00/);
  assert.match(prompt,/Busy, “Market day”/);
  assert.match(prompt,/_No stock counts for this week\._/);
  assert.match(prompt,/Both shops side by side/);
  assert.match(prompt,/4\. Differences between the shops/);
  assert.doesNotMatch(prompt,/staff_id|undefined|NaN|null/);
});

test('stock entries are validated on the device like the database will',async()=>{
  const {validateWrite,canAccess,STOCK_TAGS}=await import('../src/lib/security/policy.ts');
  const {TAG_LABELS}=await import('../src/lib/stock/ledger.ts');
  assert.deepEqual(Object.keys(TAG_LABELS),STOCK_TAGS,'every day tag has a label');
  const base={client_id:randomUUID(),staff_id:randomUUID(),recorded_at:new Date().toISOString()};
  assert.equal(canAccess('staff','stock_logs','POST'),true);
  assert.equal(canAccess('staff','stock_lines','POST'),false,'prices are a manager job');
  assert.equal(canAccess('manager','stock_lines','PATCH'),true);
  assert.equal(canAccess('manager','stock_logs','PATCH'),false,'counts are append-only');
  const good={...base,event:'count',product_id:randomUUID(),product_name:'Ham',unit:'kg',came_in:0,binned:0.25,on_hand:3.4};
  assert.ok(validateWrite('stock_logs','POST',good));
  assert.throws(()=>validateWrite('stock_logs','POST',{...good,on_hand:null}),/Invalid/,'a count needs what is left');
  assert.throws(()=>validateWrite('stock_logs','POST',{...good,on_hand:-1}),/Invalid/);
  assert.throws(()=>validateWrite('stock_logs','POST',{...good,unit:'box'}),/Invalid/);
  assert.throws(()=>validateWrite('stock_logs','POST',{...good,business_date:'2026-09-01'}),/Invalid/,'the trading day is never client-supplied');
  assert.ok(validateWrite('stock_logs','POST',{...base,event:'sold_out',product_id:null,product_name:'Ham'}));
  assert.throws(()=>validateWrite('stock_logs','POST',{...base,event:'sold_out',product_name:'Ham',on_hand:0}),/Invalid/);
  assert.ok(validateWrite('stock_logs','POST',{...base,event:'day_note',tags:['rain','busy'],note:null}));
  assert.ok(validateWrite('stock_logs','POST',{...base,event:'day_note',tags:[],note:'Market day'}));
  assert.throws(()=>validateWrite('stock_logs','POST',{...base,event:'day_note',tags:[],note:null}),/Invalid/,'an empty note says nothing');
  assert.throws(()=>validateWrite('stock_logs','POST',{...base,event:'day_note',tags:['snowmageddon']}),/Invalid/);
  assert.throws(()=>validateWrite('stock_logs','POST',{...base,event:'day_note',tags:['rain','rain']}),/Invalid/);
  assert.throws(()=>validateWrite('stock_logs','POST',{...base,event:'day_note',tags:['rain'],product_name:'Ham'}),/Invalid/);
  assert.ok(validateWrite('stock_lines','POST',{product_id:randomUUID(),unit:'kg',cost_price:9.5,sell_price:18}));
  assert.throws(()=>validateWrite('stock_lines','POST',{unit:'kg'}),/Incomplete/);
  assert.throws(()=>validateWrite('stock_lines','PATCH',{sell_price:-1}),/Invalid/);
  assert.throws(()=>validateWrite('stock_lines','POST',{product_id:randomUUID(),site_id:randomUUID()}),/Invalid/,'one price list for both shops');
  assert.ok(validateWrite('delivery_logs','POST',{...base,supplier_name:'Scrivens',accepted:true,invoice_total:125}));
  assert.throws(()=>validateWrite('delivery_logs','POST',{...base,supplier_name:'Scrivens',accepted:true,invoice_total:-5}),/Invalid/);
});

test('Postgres derives the trading day, enforces entry shapes, keeps counts append-only and prices manager-only',async()=>{
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
    for(const filename of ['0001_init.sql','0002_full_diary.sql','0003_grants_and_units.sql','20260908170550_food_log_security.sql','20260914090000_sites.sql','20260916120000_counter_stock.sql','20260917100000_shared_products.sql','20260917140000_ambient_display.sql','20260917180000_display_window.sql','20260930100000_stock_tracker.sql'])
      await db.exec((await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;',''));
    const [stratford]=(await db.query('select id from sites order by sort_order')).rows.map(r=>r.id);
    const staffUser=randomUUID(),managerUser=randomUUID(),sessionId=randomUUID();
    for(const [id,role] of [[staffUser,'staff'],[managerUser,'manager']]) await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[id,JSON.stringify({food_log_role:role})]);
    async function asUser(id) {
      await db.exec('reset role');
      await db.query('delete from auth.sessions where id=$1',[sessionId]);
      await db.query('insert into auth.sessions values($1,$2)',[sessionId,id]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[id,sessionId]);
      await db.exec('set role authenticated');
    }
    await asUser(managerUser);
    await db.exec('reset role');
    const staffId=randomUUID(),productId=randomUUID();
    await db.query("insert into staff(id,name,site_id) values($1,'Cieran',$2)",[staffId,stratford]);
    await db.query("insert into products(id,name) values($1,'Ham')",[productId]);
    await db.exec('set role authenticated');

    // Prices: the manager sets them, staff can read but not change them.
    await db.query("insert into stock_lines(product_id,unit,cost_price,sell_price) values($1,'kg',9.5,18)",[productId]);
    await assert.rejects(db.query("insert into stock_lines(product_id,unit) values($1,'kg')",[productId]),/duplicate key/,'one line per product');
    await assert.rejects(db.query("insert into stock_lines(product_id,unit,sell_price) values($1,'kg',-1)",[randomUUID()]),/check constraint|foreign key/);
    await asUser(staffUser);
    assert.equal((await db.query('select sell_price::float as p from stock_lines')).rows[0].p,18);
    assert.equal((await db.query('update stock_lines set sell_price=1 returning id')).rows.length,0,'staff cannot change prices');
    await assert.rejects(db.query("insert into stock_lines(product_id) values($1)",[randomUUID()]));

    const insert=(event,fields={})=>{
      const row={client_id:randomUUID(),staff_id:staffId,event,recorded_at:'2026-09-29T23:30:00Z',tags:[],...fields};
      const keys=Object.keys(row);
      return db.query(`insert into stock_logs(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning business_date::text as day,site_id,authenticated_user_id`,keys.map(k=>row[k]));
    };
    const saved=(await insert('count',{product_id:productId,product_name:'Ham',unit:'kg',came_in:0,binned:0.3,on_hand:2.65,business_date:'2020-01-01'})).rows[0];
    assert.equal(saved.day,'2026-09-30','23:30 UTC in BST is already the next trading day — and a client date is overwritten');
    assert.equal(saved.site_id,stratford,'shop comes from the staff member');
    assert.equal(saved.authenticated_user_id,staffUser);
    await assert.rejects(insert('count',{product_name:'Ham',unit:'kg',came_in:0,binned:0}),/check constraint/,'a count needs what is left');
    await assert.rejects(insert('count',{product_name:'Ham',unit:'kg',came_in:null,binned:0,on_hand:1}),/check constraint/,'nulls cannot slip through');
    await assert.rejects(insert('count',{product_name:'Ham',unit:'kg',came_in:0,binned:0,on_hand:-1}),/check constraint/);
    await insert('sold_out',{product_id:productId,product_name:'Ham'});
    await assert.rejects(insert('sold_out',{product_name:'Ham',on_hand:0}),/check constraint/);
    await insert('day_note',{tags:['rain','busy']});
    await insert('day_note',{note:'Market day'});
    await assert.rejects(insert('day_note',{}),/check constraint/,'an empty note is refused');
    await assert.rejects(insert('day_note',{tags:['snowmageddon']}),/check constraint/);
    await assert.rejects(db.query('update stock_logs set on_hand=100'),/permission denied/);
    await assert.rejects(db.query('delete from stock_logs'),/permission denied/);

    await db.query("insert into delivery_logs(client_id,staff_id,supplier_name,accepted,invoice_total,recorded_at) values($1,$2,'Scrivens',true,125.00,now())",[randomUUID(),staffId]);
    await assert.rejects(db.query("insert into delivery_logs(client_id,staff_id,supplier_name,accepted,invoice_total,recorded_at) values($1,$2,'Scrivens',true,-1,now())",[randomUUID(),staffId]),/check constraint/);
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from stock_logs'),/permission denied/);
    await assert.rejects(db.query('select * from stock_lines'),/permission denied/);
  } finally {await db.close();}
});
