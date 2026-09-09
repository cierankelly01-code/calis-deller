import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin='http://localhost:3100';
let checks=0;
const eq=(actual,expected)=>{assert.equal(actual,expected);checks++;};
async function request(path,method='GET',body,cookie,extra={}) {
  return fetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},body:body?JSON.stringify(body):undefined});
}
async function login(role) {
  const response=await request('/api/auth','POST',{email:`${role}@example.test`,password:'local-test-password'});
  eq(response.status,200);
  const cookies=response.headers.getSetCookie();
  for(const cookie of cookies) {
    assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=strict/i);
    assert.match(cookie,/__Host-food-log-/);checks+=4;
  }
  return cookies.map(value=>value.split(';')[0]).join('; ');
}
eq((await request('/api/auth')).status,401);
eq((await request('/api/data/staff')).status,401);
eq((await request('/api/data/staff','POST',{name:'forged'})).status,401);
eq((await request('/api/auth','POST',{email:'x@example.test',password:'test'},null,{Origin:'https://evil.example'})).status,403);
const settings=await request('/settings');
// Next.js can stream the redirect in HTML after headers have been sent.
if(settings.status===307)assert.match(settings.headers.get('location'),/\/login/);
else assert.match(await settings.text(),/\/login\?next=/);
checks++;
for(const path of ['/.env','/.env.local','/.git/config','/package.json','/supabase/seed.sql'])eq((await request(path)).status,404);
const page=await request('/');
eq(page.status,200);
assert.match(page.headers.get('content-security-policy'),/nonce-/);checks++;
eq(page.headers.get('x-content-type-options'),'nosniff');
eq(page.headers.get('x-frame-options'),'DENY');
eq(page.headers.get('x-powered-by'),null);
assert.match(page.headers.get('cache-control'),/no-store/);checks++;
const staff=await login('staff');
eq((await request('/api/data/staff','GET',null,staff)).status,200);
eq((await request('/api/data/staff','POST',{name:'forged'},staff)).status,403);
eq((await request('/api/data/products','PATCH',{name:'forged'},staff)).status,403);
eq((await request('/api/data/User','GET',null,staff)).status,403);
eq((await request('/api/data/staff?select=*,users(*)','GET',null,staff)).status,400);
const staffPage=await request('/settings','GET',null,staff);
assert.match(await staffPage.text(),/Manager access required/);checks++;
const common={client_id:randomUUID(),staff_id:'11111111-1111-4111-8111-111111111111',recorded_at:new Date().toISOString()};
const entries={
  fridge_temp_logs:{unit_id:'22222222-2222-4222-8222-222222222222',period:'am',reading_c:3,in_range:true},
  cooking_logs:{product_name:'Test food',quantity:1,temp_c:80,in_range:true,check_type:'cooking'},
  delivery_logs:{supplier_name:'Test supplier',accepted:true},
  cleaning_logs:{task_id:'33333333-3333-4333-8333-333333333333',session:'open'},
  probe_calibration_logs:{method:'ice',reading_c:0,pass:true},
};
for(const [table,entry] of Object.entries(entries)) {
  const payload={...common,...entry,client_id:randomUUID()};
  eq((await request(`/api/data/${table}`,'POST',payload,staff)).status,201);
  eq((await request(`/api/data/${table}`,'POST',payload,staff)).status,204);
  const read=await request(`/api/data/${table}?client_id=eq.${payload.client_id}`,'GET',null,staff);
  eq((await read.json()).length,1);
  eq((await request(`/api/data/${table}`,'PATCH',{reading_c:4},staff)).status,403);
}
const manager=await login('manager');
eq((await request('/settings','GET',null,manager)).status,200);
eq((await request('/api/data/staff','POST',{name:'New name'},manager)).status,201);
eq((await request('/api/data/staff','PATCH',{active:false},manager)).status,400);
eq((await request('/api/data/staff?id=eq.11111111-1111-4111-8111-111111111111','PATCH',{name:'Updated'},manager)).status,204);
eq((await request('/api/data/staff?id=eq.00000000-0000-4000-8000-000000000000','PATCH',{name:'Missing'},manager)).status,409);
eq((await request('/api/data/staff','POST',{name:'Bad',role:'manager'},manager)).status,400);
eq((await request('/api/data/staff','POST',{name:'x'.repeat(20000)},manager)).status,413);
eq((await request('/api/data/staff','POST',{name:'Cross site'},manager,{Origin:'https://evil.example'})).status,403);
eq((await request('/api/auth','DELETE',null,manager)).status,200);
eq((await request('/api/auth','GET',null,manager)).status,401);
for(let i=0;i<10;i++)await request('/api/auth','POST',{email:'brute@example.test',password:'wrong'});
eq((await request('/api/auth','POST',{email:'brute@example.test',password:'wrong'})).status,429);
console.log(`${checks} production HTTP security/save assertions passed (simulated Supabase Auth/API).`);
