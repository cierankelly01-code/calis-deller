"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearDisplayCache, setBrowserUser, type BrowserUser } from '@/lib/security/browser-session';
import { claimLegacyEntries, getUnsyncedEntries, removeSyncedEntries } from '@/lib/offline/outbox';
import { syncOutbox } from '@/lib/offline/sync';
import { MobileNav } from '@/components/ui/MobileNav';

const UserContext = createContext<BrowserUser|null>(null);
export function useUser() {return useContext(UserContext);}

export function AuthBoundary({children}:{children:React.ReactNode}) {
  const router = useRouter();
  const [user,setUser] = useState<BrowserUser|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [legacy,setLegacy] = useState(0);
  useEffect(()=>{
    let cancelled=false;
    let verifiedAt=0;
    async function check() {
      try {
        const response=await fetch('/api/auth',{cache:'no-store', signal: AbortSignal.timeout(8000)});
        if(cancelled)return;
        if(response.ok) {
          const next:BrowserUser=await response.json();
          verifiedAt=Date.now();
          setBrowserUser(next);setUser(next);setError('');
          setLegacy((await getUnsyncedEntries()).filter(entry=>!entry.ownerId).length);
        } else if(response.status===401) {
          setBrowserUser(null);setUser(null);clearDisplayCache();
        } else {setError('Unable to verify access. Please retry.');}
      } catch (err) {
        // Offline capture continues in an already verified, open session.
        // Reloading offline requires reconnecting to verify the account.
        if(!verifiedAt)setError(err instanceof DOMException && err.name === 'TimeoutError' ? 'The server is taking too long to respond. Ask the manager to check the Coolify deployment.' : 'Connect to the internet to sign in.');
      } finally {if(!cancelled)setLoading(false);}
      if(verifiedAt && Date.now()-verifiedAt>12*60*60*1000) {setBrowserUser(null);setUser(null);}
    }
    const required=()=>{setBrowserUser(null);setUser(null);setError('Your session ended. Sign in to sync saved entries.');};
    void check();
    const timer=setInterval(()=>void check(),60000);
    window.addEventListener('online',check);
    window.addEventListener('food-log-sign-in-required',required);
    return ()=>{cancelled=true;clearInterval(timer);window.removeEventListener('online',check);window.removeEventListener('food-log-sign-in-required',required);};
  },[]);

  async function signIn(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    try {
      const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.get('email'),password:form.get('password')})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.message);
      clearDisplayCache();
      const next=new URLSearchParams(location.search).get('next');
      router.replace(next && /^\/settings(?:\/(?:staff|units|suppliers|cleaning))?$/.test(next)?next:location.pathname==='/login'?'/':location.pathname);
    } catch(err) {setError(err instanceof Error?err.message:'Unable to sign in');setBusy(false);}
  }
  async function signOut() {
    setBusy(true);setError('');
    try {
      await syncOutbox();
      const pending=await getUnsyncedEntries();
      if(pending.some(entry=>entry.ownerId===user?.id || !entry.ownerId)) throw new Error('Entries are still saved on this device. Sync them before signing out.');
      const response=await fetch('/api/auth',{method:'DELETE'});
      if(!response.ok)throw new Error('Unable to sign out. Check your connection and retry.');
      setBrowserUser(null);
      await removeSyncedEntries();
      clearDisplayCache();
      router.replace('/');
    } catch(err) {setError(err instanceof Error?err.message:'Unable to sign out');setBusy(false);}
  }
  async function recoverLegacy() {
    if(!user || user.role!=='manager')return;
    setBusy(true);setError('');
    try {await claimLegacyEntries(user.id);setLegacy(0);await syncOutbox();}
    catch {setError('Unable to recover entries. They remain on this device.');}
    finally {setBusy(false);}
  }
  if(loading)return <main className="p-8 text-center">Checking access…</main>;
  if(!user)return <main className="min-h-[100dvh] bg-ink text-paper px-5 py-8 sm:grid sm:place-items-center">
    <div className="w-full max-w-4xl mx-auto sm:grid sm:grid-cols-[1fr_0.86fr] overflow-hidden rounded-[2rem] border border-paper/15 bg-paper text-ink shadow-2xl">
      <section className="hidden sm:flex flex-col justify-between bg-brand p-10 text-white">
        <div><p className="text-sm font-bold uppercase tracking-[0.24em] opacity-75">Kelly&apos;s Deli</p><h1 className="mt-16 text-5xl font-black leading-[0.95] tracking-tight">Good checks.<br/>Good food.<br/>Good record.</h1></div>
        <p className="max-w-xs text-sm leading-6 text-white/75">The quick, calm way to keep every fridge, delivery and prep check accounted for.</p>
      </section>
      <section className="p-7 sm:p-10">
        <div className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Food safety diary</p><h1 className="mt-2 text-3xl font-black tracking-tight">Welcome back</h1><p className="mt-2 text-ink-soft">Sign in to record today&apos;s checks.</p></div>
    <form onSubmit={signIn} className="space-y-4">
      <label className="block">Email<input name="email" type="email" autoComplete="username" maxLength={254} required className="block w-full border rounded-xl p-3 mt-1 bg-surface" /></label>
      <label className="block">Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required className="block w-full border rounded-xl p-3 mt-1 bg-surface" /></label>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl p-3.5 bg-brand text-white font-bold shadow-lg shadow-brand/20 hover:bg-brand-deep transition-colors">{busy?'Signing in…':'Sign in'}</button>
    </form>
    <p className="mt-6 text-xs leading-5 text-ink-soft">Need access? Ask your manager for an account or password reset.</p>
      </section>
    </div>
  </main>;
  return <UserContext.Provider value={user}>
    <div className="px-4 py-2 border-b border-line text-sm flex justify-between gap-3"><span>{user.email} · {user.role}</span><button onClick={signOut} disabled={busy} className="underline">Sign out</button></div>
    {error && <p role="alert" className="px-4 py-2 text-danger">{error}</p>}
    {legacy>0 && <div role="status" className="px-4 py-3 bg-gold-soft">{legacy} entries saved before account sign-in need manager review. {user.role==='manager' && <button onClick={recoverLegacy} disabled={busy} className="underline font-bold">Claim and sync this device&apos;s entries</button>}</div>}
    <div className="pb-16 md:pb-0">{children}</div>
    <MobileNav />
  </UserContext.Provider>;
}
