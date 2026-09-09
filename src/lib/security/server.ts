import 'server-only';
import { cookies } from 'next/headers';
import { createClient, type Session } from '@supabase/supabase-js';
import { sameOrigin } from './policy';

const production = process.env.NODE_ENV === 'production';
const prefix = production ? '__Host-food-log-' : 'food-log-';
const cookieOptions = {httpOnly:true,secure:production,sameSite:'strict' as const,path:'/',maxAge:43200};

export function backendConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Backend configuration missing');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error('Invalid backend URL');
  if (key.startsWith('sb_secret_')) throw new Error('Privileged key not permitted');
  if (key.startsWith('eyJ')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (claims.role !== 'anon') throw new Error('Only a publishable key is permitted');
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Invalid publishable key');
  return {url:parsed.origin,key};
}

export function authClient() {
  const {url,key} = backendConfig();
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(10000)})}});
}

export async function saveSession(session: Session) {
  const jar = await cookies();
  jar.set(prefix+'access',session.access_token,cookieOptions);
  jar.set(prefix+'refresh',session.refresh_token,cookieOptions);
}
export async function clearSession() {
  const jar = await cookies();
  for (const key of ['access','refresh']) jar.set(prefix+key,'',{...cookieOptions,maxAge:0});
}

const refreshes = new Map<string,Promise<Session | null>>();
export async function identity(refresh = true) {
  const jar = await cookies();
  let token = jar.get(prefix+'access')?.value;
  if (!token || token.length > 8192) return null;
  const client = authClient();
  let result = await client.auth.getUser(token);
  if (result.error && refresh) {
    const refreshToken = jar.get(prefix+'refresh')?.value;
    if (!refreshToken || refreshToken.length > 1024) return null;
    let pending = refreshes.get(refreshToken);
    if (!pending) {
      if (refreshes.size > 1000) return null;
      pending = client.auth.refreshSession({refresh_token:refreshToken}).then(({data,error})=>error?null:data.session);
      refreshes.set(refreshToken,pending);
      setTimeout(()=>refreshes.delete(refreshToken),10000).unref();
    }
    const session = await pending;
    if (!session) return null;
    await saveSession(session);
    token = session.access_token;
    result = await client.auth.getUser(token);
  }
  if (result.error || !result.data.user || result.data.user.is_anonymous) return null;
  const user = result.data.user;
  const role = user.app_metadata.food_log_role;
  if (role !== 'staff' && role !== 'manager') return null;
  return {id:user.id,email:user.email,role:role as 'staff'|'manager',token};
}

export function enforceOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  if (production && !configured) throw new HttpError(503,'Service configuration required');
  const origin = configured ? new URL(configured).origin : new URL(request.url).origin;
  if (!sameOrigin(request.headers,origin)) throw new HttpError(403,'Request not allowed');
}

export class HttpError extends Error {
  status: number;
  constructor(status:number,message:string) {super(message);this.status=status;}
}
export async function readJson(request: Request, limit = 16384): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'JSON required');
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413,'Entry too large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400,'Entry required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {await reader.cancel();throw new HttpError(413,'Entry too large');}
    chunks.push(value);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new HttpError(400,'Invalid JSON');}
}
export function json(data:unknown,status=200) {return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});}
export function failure(error:unknown) {
  return json({message:error instanceof HttpError ? error.message : 'Unable to complete request'},error instanceof HttpError ? error.status : 503);
}
