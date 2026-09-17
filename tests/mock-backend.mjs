// Test-process preload only. Never imported by the app or shipped in Docker.
// Supabase Auth/PostgREST are simulated; actual database policies are tested
// separately in database.test.mjs against PostgreSQL.
import { randomUUID } from 'node:crypto';
process.env.SUPABASE_URL='https://food-log-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test_fixture_only';
process.env.APP_ORIGIN='http://localhost:3100';
const originalFetch=globalThis.fetch;
const sessions=new Map();
const refreshTokens=new Map();
const staffId='11111111-1111-4111-8111-111111111111';
const unitId='22222222-2222-4222-8222-222222222222';
const taskId='33333333-3333-4333-8333-333333333333';
const siteId='44444444-4444-4444-8444-444444444444';
const tables={
  sites:[{id:siteId,slug:'test',name:'Test Deli',short_name:'Test',active:true,sort_order:1}],
  staff:[{id:staffId,site_id:siteId,name:'Test colleague',active:true,sort_order:1}],
  fridge_units:[{id:unitId,site_id:siteId,name:'Test fridge',unit_type:'fridge',target_min_c:1,target_max_c:5,active:true,sort_order:1}],
  cleaning_tasks:[{id:taskId,site_id:siteId,name:'Test worktops',session:'both',active:true,sort_order:1}],
  suppliers:[],products:[],fridge_temp_logs:[],cooking_logs:[],delivery_logs:[],cleaning_logs:[],probe_calibration_logs:[],counter_stock_logs:[],
};
function sessionFor(role) {
  const id=role==='manager'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const user={id,email:`${role}@example.test`,aud:'authenticated',role:'authenticated',app_metadata:{food_log_role:role},user_metadata:{},created_at:new Date().toISOString()};
  const token=[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
  sessions.set(token,user);
  const refresh_token=randomUUID();refreshTokens.set(refresh_token,{role,token});
  return {access_token:token,refresh_token,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
}
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.hostname!=='food-log-test.supabase.co')return originalFetch(input,init);
  const headers=new Headers(init.headers);
  const method=init.method??'GET';
  const token=headers.get('authorization')?.replace(/^Bearer /,'');
  const user=sessions.get(token);
  const data=init.body?JSON.parse(init.body):null;
  if(url.pathname==='/auth/v1/token') {
    if(url.searchParams.get('grant_type')==='refresh_token') {
      const saved=refreshTokens.get(data?.refresh_token);
      return saved?Response.json(sessionFor(saved.role)):Response.json({message:'Invalid token'},{status:401});
    }
    const role=data?.email?.split('@')[0];
    if(!['manager','staff'].includes(role)||data.email!==`${role}@example.test`||data.password!=='local-test-password')return Response.json({msg:'Invalid credentials'},{status:400});
    return Response.json(sessionFor(role));
  }
  if(url.pathname==='/auth/v1/user')return user?Response.json(user):Response.json({message:'Invalid token'},{status:401});
  if(url.pathname==='/auth/v1/logout'){
    sessions.delete(token);
    for(const [key,value] of refreshTokens)if(value.token===token)refreshTokens.delete(key);
    return new Response(null,{status:204});
  }
  if(!user)return Response.json({message:'Sign in required'},{status:401});
  const table=url.pathname.split('/').at(-1);
  if(!Object.hasOwn(tables,table))return Response.json({message:'Not found'},{status:404});
  let rows=tables[table];
  const matches=row=>[...url.searchParams].every(([key,value])=>{
    if(['select','order','limit','offset'].includes(key))return true;
    const index=value.indexOf('.'),op=value.slice(0,index),operand=value.slice(index+1);
    if(op==='eq')return String(row[key])===operand;
    if(op==='in')return operand.slice(1,-1).split(',').includes(String(row[key]));
    if(op==='gte')return row[key]>=operand;
    if(op==='lt')return row[key]<operand;
    return false;
  });
  if(method==='POST') {
    if(data.client_id && rows.some(row=>row.client_id===data.client_id))return Response.json({code:'23505'},{status:409});
    // Mirrors the stamp trigger: the bin-by date is server-derived (open
    // life counts the day opened; a sooner pack use-by wins).
    if(table==='counter_stock_logs'&&data.event==='put_out'){const d=new Date(data.recorded_at);d.setDate(d.getDate()+data.open_life_days-1);const byLife=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;data.discard_by=data.pack_use_by&&data.pack_use_by<byLife?data.pack_use_by:byLife;}
    rows.push({id:randomUUID(),active:true,sort_order:0,allergens:[],may_contain:[],site_id:tables.staff.find(s=>s.id===data.staff_id)?.site_id,created_at:new Date().toISOString(),synced_at:new Date().toISOString(),...data,authenticated_user_id:user.id});
    return new Response(null,{status:201});
  }
  if(method==='PATCH') {const found=rows.filter(matches);for(const row of found)Object.assign(row,data);return Response.json(found);}
  rows=rows.filter(matches);
  const select=url.searchParams.get('select');
  if(select&&select!=='*')rows=rows.map(row=>Object.fromEntries(select.split(',').map(key=>[key,row[key]])));
  return Response.json(rows);
};
