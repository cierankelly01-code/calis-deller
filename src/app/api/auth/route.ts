import { createHash } from 'node:crypto';
import { authClient, backendConfig, clearSession, enforceOrigin, failure, HttpError, identity, json, readJson, saveSession } from '@/lib/security/server';
import { RateLimiter } from '@/lib/security/policy';

const attempts = new RateLimiter(10,15*60*1000);
const globalAttempts = new RateLimiter(100,15*60*1000);
export async function GET() {
  try {
    const user = await identity();
    return user ? json({id:user.id,email:user.email,role:user.role}) : json({message:'Sign in required'},401);
  } catch(error) {return failure(error);}
}
export async function POST(request:Request) {
  try {
    enforceOrigin(request);
    const input = await readJson(request,4096);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400,'Email and password required');
    const {email,password} = input as Record<string,unknown>;
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || password.length < 1 || password.length > 256) throw new HttpError(400,'Email and password required');
    const normalized = email.trim().toLowerCase();
    const key = createHash('sha256').update(normalized).digest('hex');
    // Do not trust spoofable forwarding headers for brute-force protection.
    if (!attempts.allow(key) || !globalAttempts.allow('login')) return new Response(JSON.stringify({message:'Too many attempts. Try again in 15 minutes.'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'900','Cache-Control':'no-store'}});
    const {data,error} = await authClient().auth.signInWithPassword({email:normalized,password});
    if (error || !data.session || !['staff','manager'].includes(data.user?.app_metadata.food_log_role)) throw new HttpError(401,'Sign-in failed. Check your account details and access.');
    await saveSession(data.session);
    return json({id:data.user.id,email:data.user.email,role:data.user.app_metadata.food_log_role});
  } catch(error) {return failure(error);}
}
export async function DELETE(request:Request) {
  try {
    enforceOrigin(request);
    const user = await identity();
    if (user) {
      const {url,key} = backendConfig();
      const response = await fetch(`${url}/auth/v1/logout`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${user.token}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new HttpError(503,'Unable to sign out. Please retry.');
    }
    await clearSession();
    return json({ok:true});
  } catch(error) {return failure(error);}
}
