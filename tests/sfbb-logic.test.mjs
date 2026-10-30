import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/')?pathToFileURL(resolve('src',specifier.slice(2)+'.ts')).href:specifier,context);
}});

test('cooling clock: two hours from the oven, probes, finished batches and staged alerts',async()=>{
  const {onTheClock,finished,summariseCooling,coolingAlerts,coolingRate,computeDueBy}=await import('../src/lib/cooling/board.ts');
  const staff=randomUUID();
  const at=(h,m)=>new Date(Date.UTC(2026,9,30,h,m)).toISOString();
  const row=(over)=>({id:randomUUID(),client_id:randomUUID(),staff_id:staff,batch_client_id:null,cooking_client_id:null,product_id:null,product_name:'Sausage rolls',quantity:null,temp_c:null,due_by:null,outcome:null,note:null,...over});
  assert.equal(computeDueBy(new Date(at(9,0))),at(11,0));
  const a=row({event:'out',cooking_client_id:randomUUID(),quantity:20,recorded_at:at(9,0),due_by:at(11,0)});
  const b=row({event:'out',cooking_client_id:randomUUID(),quantity:12,recorded_at:at(10,0)}); // queued: no server due_by yet
  const logs=[a,b,
    row({event:'probe',batch_client_id:a.client_id,temp_c:70,recorded_at:at(9,0)}),
    row({event:'probe',batch_client_id:a.client_id,temp_c:40,recorded_at:at(9,30)})];
  const clock=onTheClock(logs,Date.parse(at(10,45)));
  assert.deepEqual(clock.map(c=>[c.quantity,c.status,c.dueBy]),[[20,'soon',at(11,0)],[12,'ok',at(12,0)]],'soonest first; a queued batch gets the deadline the server will stamp');
  assert.deepEqual(clock[0].probes.map(p=>p.temp),[70,40]);
  assert.equal(coolingRate(clock[0].probes),15,'30°C in 30 minutes = 15°C per 15 minutes');
  assert.equal(coolingRate([]),null);
  assert.deepEqual(summariseCooling(clock),{onClock:2,soon:1,overdue:0,soonestMsLeft:15*60_000});
  const fired=new Set();
  assert.deepEqual(coolingAlerts(clock,fired).map(x=>x.key),[`${a.client_id}:30m`]);
  fired.add(`${a.client_id}:30m`);
  const late=onTheClock(logs,Date.parse(at(11,5)));
  assert.equal(late[0].status,'overdue');
  assert.deepEqual(coolingAlerts(late,fired).map(x=>x.key),[`${a.client_id}:due`]);
  const closed=[...logs,row({event:'done',batch_client_id:a.client_id,outcome:'chilled',quantity:5,recorded_at:at(11,10)})];
  assert.deepEqual(onTheClock(closed,Date.parse(at(11,15))).map(c=>c.quantity),[12],'a finished batch leaves the clock');
  const [done]=finished(closed);
  assert.equal(done.outcome,'chilled');assert.equal(done.left,5);assert.equal(done.lateBy,10*60_000,'finished 10 minutes after the 2 hours');
  const {lateFinishes}=await import('../src/lib/cooling/board.ts');
  const onTime=row({event:'done',batch_client_id:b.client_id,outcome:'sold_out',quantity:0,recorded_at:at(11,30)});
  assert.deepEqual([...lateFinishes([...closed,onTime])],[closed.at(-1).id],'only the batch chilled after its 2 hours is flagged');
});

test('today jobs: red first, weekly checks, manager-only jobs',async()=>{
  const {buildJobs,jobsLeft}=await import('../src/lib/today/jobs.ts');
  const {findMethod}=await import('../src/lib/methods/content.ts');
  const now=new Date(2026,9,30,10,0);
  const base={now,slot:'am',fridges:{total:4,due:0,outOfRange:0},cleaning:{session:'open',total:5,done:5},cooling:{onClock:0,soon:0,overdue:0,soonestLabel:null},sandwiches:{overdue:0,soon:false,label:null},counter:{overdue:0,dueToday:0},
    siteChecks:[{kind:'hand_wash',ok:true,recorded_at:new Date(2026,9,30,8,0).toISOString()},{kind:'pest',ok:true,recorded_at:new Date(2026,9,25,8,0).toISOString()}],
    probeChecks:[{pass:true,recorded_at:new Date(2026,9,27).toISOString()}]};
  const calm=buildJobs(base);
  assert.equal(jobsLeft(calm),0,'everything done');
  assert.deepEqual(calm.map(j=>j.key),['fridge','cleaning','hand_wash','pest','probe'],'staff see no manager jobs');
  const busy=buildJobs({...base,fridges:{total:4,due:2,outOfRange:1},cooling:{onClock:1,soon:0,overdue:1,soonestLabel:null},siteChecks:[{kind:'hand_wash',ok:true,recorded_at:new Date(2026,9,29,8,0).toISOString()}],probeChecks:[],lastReviewAt:null,certificatesExpiring:2});
  assert.deepEqual(busy.filter(j=>j.tone==='red').map(j=>j.key),['fridge','cooling'],'out of range and over time are red');
  assert.equal(busy.find(j=>j.key==='hand_wash').tone,'amber','a check from yesterday does not count today');
  assert.equal(busy.find(j=>j.key==='pest').tone,'amber','no pest check this week');
  assert.ok(busy.find(j=>j.key==='review')&&busy.find(j=>j.key==='training'),'managers see review and certificates');
  for(const j of busy)assert.ok(findMethod(j.method),`job ${j.key} links to a real method (${j.method})`);
});

test('safe methods: unique ids, steps, links to real screens, no invented cooling time',async()=>{
  const {SAFE_METHODS,METHOD_GROUPS}=await import('../src/lib/methods/content.ts');
  const ids=SAFE_METHODS.map(m=>m.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(ids.every(id=>/^[a-z0-9-]{1,60}$/.test(id)),'ids fit the database check');
  const groups=new Set(METHOD_GROUPS.map(g=>g.id));
  const screens=['/log/fridge','/log/cooking','/cooling','/log/delivery','/log/cleaning','/log/probe','/counter','/sandwiches','/allergens','/checks','/training','/review','/health','/trace'];
  for(const m of SAFE_METHODS){
    assert.ok(groups.has(m.group),m.id);
    assert.ok(m.steps.length>=3,`${m.id} has steps`);
    assert.ok(m.wrong.length>=1,`${m.id} says what to do if it goes wrong`);
    if(m.appCheck)assert.ok(screens.includes(m.appCheck.href),`${m.id} links to a real screen`);
  }
  assert.ok(!/90 ?min/i.test(JSON.stringify(SAFE_METHODS)),'no invented cooling minutes');
});

test('training: longest-lasting certificate counts, expiry warnings, methods trained',async()=>{
  const {trainingByPerson,certStatus,certificatesNeedingAction}=await import('../src/lib/training/status.ts');
  const staffA=randomUUID(),staffB=randomUUID(),staffC=randomUUID();
  const rec=(over)=>({id:randomUUID(),client_id:randomUUID(),staff_id:randomUUID(),kind:'certificate',topic:'Level 2 Food Hygiene',trained_on:'2023-01-01',expires_on:null,certificate_path:null,note:null,recorded_at:'2026-10-01T10:00:00Z',...over});
  const today=new Date('2026-10-30T12:00:00');
  const records=[
    rec({trainee_id:staffA,expires_on:'2026-11-10'}),
    rec({trainee_id:staffA,kind:'method',topic:'hand-washing'}),
    rec({trainee_id:staffA,kind:'induction',topic:'First-day induction'}),
    rec({trainee_id:staffB,expires_on:'2026-01-01'}),
    rec({trainee_id:staffB,expires_on:'2029-01-01',recorded_at:'2026-10-02T10:00:00Z'}),
  ];
  const people=trainingByPerson(records,[staffA,staffB,staffC],today);
  assert.deepEqual(people.map(p=>p.certStatus),['expiring','ok','none'],'renewal wins; no certificate is flagged');
  assert.ok(people[0].methods.has('hand-washing'));assert.ok(people[0].inducted);
  assert.equal(certificatesNeedingAction(people),2);
  assert.equal(certStatus(rec({expires_on:'2026-10-29'}),today),'expired');
});

test('trace: one product through delivery, cooking, cooling and counter, in time order',async()=>{
  const {buildTrace}=await import('../src/lib/trace/timeline.ts');
  const staff=randomUUID(),out=randomUUID(),delivery=randomUUID();
  const t=(h,m)=>new Date(Date.UTC(2026,9,29,h,m)).toISOString();
  const events=buildTrace({
    cooking:[{id:'c',client_id:'c',staff_id:staff,check_type:'cooking',product_name:'Sausage Rolls',quantity:20,temp_c:82,in_range:true,corrective_action:null,recorded_at:t(9,0)},{id:'x',client_id:'x',staff_id:staff,check_type:'cooking',product_name:'Quiche',quantity:2,temp_c:80,in_range:true,corrective_action:null,recorded_at:t(9,5)}],
    hotBatches:[{id:'o',client_id:out,staff_id:staff,event:'out',batch_client_id:null,product_name:'Sausage Rolls',quantity:20,temp_c:null,due_by:t(11,0),outcome:null,recorded_at:t(9,1)},{id:'d',client_id:'d',staff_id:staff,event:'done',batch_client_id:out,product_name:'Sausage Rolls',quantity:6,temp_c:7,due_by:null,outcome:'chilled',recorded_at:t(11,20)}],
    counter:[{id:'p',client_id:'p',staff_id:staff,event:'put_out',product_name:'sausage rolls',delivery_log_id:delivery,discard_by:'2026-10-31',batch_code:null,reason:null,note:null,recorded_at:t(11,21)}],
    ambient:[],
    deliveries:[{id:delivery,staff_id:staff,supplier_name:'Butcher',chilled_temp_c:3,accepted:true,rejection_reason:null,recorded_at:t(7,0)}],
    deliveryLabels:new Map([[delivery,'Butcher · 29 Oct']]),
  },'sausage');
  assert.deepEqual(events.map(e=>e.kind),['delivery','cooking','cooling','cooling','counter'],'quiche left out; in time order');
  assert.match(events[1].detail,/82°C/);
  assert.ok(events[3].flag,'chilled after the 2 hours is flagged');
  assert.match(events[3].detail,/AFTER the 2 hours/);
});

test('API rules: personal data is manager-only, new entries validated like the database',async()=>{
  const {canAccess,validateWrite}=await import('../src/lib/security/policy.ts');
  for(const t of ['training_records','health_logs']){
    assert.equal(canAccess('staff',t,'GET'),false,`staff cannot read ${t}`);
    assert.equal(canAccess('staff',t,'POST'),false);
    assert.equal(canAccess('manager',t,'GET'),true);assert.equal(canAccess('manager',t,'POST'),true);
  }
  assert.equal(canAccess('staff','method_records','GET'),true);assert.equal(canAccess('staff','method_records','POST'),false);
  assert.equal(canAccess('staff','review_logs','POST'),false);
  assert.equal(canAccess('staff','hot_batch_logs','POST'),true);assert.equal(canAccess('staff','site_check_logs','POST'),true);
  assert.equal(canAccess('staff','food_log_contacts','POST'),false);assert.equal(canAccess('manager','food_log_contacts','PATCH'),true);
  assert.equal(canAccess('manager','hot_batch_logs','PATCH'),false,'logs are never edited');
  const base={client_id:randomUUID(),staff_id:randomUUID(),recorded_at:new Date().toISOString()};
  assert.ok(validateWrite('hot_batch_logs','POST',{...base,event:'out',cooking_client_id:randomUUID(),product_name:'Sausage rolls',quantity:20}));
  assert.throws(()=>validateWrite('hot_batch_logs','POST',{...base,event:'out',product_name:'Sausage rolls',quantity:20}),/Invalid/,'needs its cooking check');
  assert.throws(()=>validateWrite('hot_batch_logs','POST',{...base,event:'out',cooking_client_id:randomUUID(),product_name:'S',quantity:20,due_by:new Date().toISOString()}),/Invalid/,'deadline never client-supplied');
  assert.throws(()=>validateWrite('hot_batch_logs','POST',{...base,event:'probe',batch_client_id:randomUUID(),product_name:'S'}),/Invalid/,'probe needs a temperature');
  assert.ok(validateWrite('hot_batch_logs','POST',{...base,event:'done',batch_client_id:randomUUID(),product_name:'S',quantity:0,outcome:'sold_out'}));
  assert.throws(()=>validateWrite('health_logs','POST',{...base,subject_id:randomUUID(),event:'cleared',symptom_free_48h:false}),/48 hours/);
  assert.throws(()=>validateWrite('site_check_logs','POST',{...base,kind:'pest',ok:false}),/did about it/);
  assert.throws(()=>validateWrite('review_logs','POST',{...base,all_ok:false,changes:[]}),/problems/);
  assert.throws(()=>validateWrite('training_records','POST',{...base,trainee_id:randomUUID(),kind:'method',topic:'x',trained_on:'2026-10-30',certificate_path:`${randomUUID()}/${randomUUID()}.jpg`}),/Invalid/,'only certificates carry a file');
  assert.throws(()=>validateWrite('training_records','POST',{...base,trainee_id:randomUUID(),kind:'certificate',topic:'x',trained_on:'2026-10-30',certificate_path:'../x.jpg'}),/Invalid/);
  assert.throws(()=>validateWrite('food_log_contacts','POST',{name:'Pest Co',site_id:randomUUID(),phone:'<script>'}),/Invalid/);
  assert.throws(()=>validateWrite('method_records','POST',{...base,method_id:'Not An Id'}),/Invalid/);
});
