import 'fake-indexeddb/auto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

registerHooks({resolve(specifier,context,nextResolve) {
  return nextResolve(specifier.startsWith('@/')?pathToFileURL(resolve('src',specifier.slice(2)+'.ts')).href:specifier,context);
}});

test('offline entries survive failures, respect account ownership and only acknowledge confirmed saves',async()=>{
  const {setBrowserUser}=await import('../src/lib/security/browser-session.ts');
  const {queueEntry,getUnsyncedEntries,claimLegacyEntries}=await import('../src/lib/offline/outbox.ts');
  const {syncOutbox}=await import('../src/lib/offline/sync.ts');
  const user={id:randomUUID(),role:'staff'};
  const payload={staff_id:randomUUID(),task_id:randomUUID(),session:'open',recorded_at:new Date().toISOString()};
  Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
  await assert.rejects(queueEntry('cleaning_logs',payload),/Sign in/);
  setBrowserUser(user);
  await assert.rejects(queueEntry('cleaning_logs',{...payload,task_id:'bad'}));
  const id=await queueEntry('cleaning_logs',payload);
  assert.equal((await getUnsyncedEntries())[0].ownerId,user.id);
  assert.equal((await syncOutbox()).synced,0);
  navigator.onLine=true;
  const originalFetch=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return Response.json({message:'Network failure'},{status:503});};
    assert.equal((await syncOutbox()).remaining,1);
    setBrowserUser({id:randomUUID(),role:'staff'});
    const previous=calls;
    assert.equal((await syncOutbox()).synced,0);
    assert.equal(calls,previous,'other account never sends this entry');
    await assert.rejects(claimLegacyEntries(user.id),/Manager/);
    setBrowserUser(user);
    globalThis.fetch=async()=>Response.json({code:'23505',message:'unverified duplicate'},{status:409});
    assert.equal((await syncOutbox()).remaining,1,'arbitrary duplicate is not success');
    globalThis.fetch=async(input,init)=>{
      assert.equal(input,'/api/data/cleaning_logs');
      assert.equal(new Headers(init.headers).has('authorization'),false);
      assert.equal(new Headers(init.headers).has('apikey'),false);
      assert.equal(JSON.parse(init.body).client_id,id);
      return new Response(null,{status:201});
    };
    assert.deepEqual(await syncOutbox(),{synced:1,remaining:0});
    assert.equal((await getUnsyncedEntries()).length,0);
  } finally {globalThis.fetch=originalFetch;setBrowserUser(null);}
});
