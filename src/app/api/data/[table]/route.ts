import { backendConfig, enforceOrigin, failure, HttpError, identity, json, readJson } from '@/lib/security/server';
import { canAccess, RateLimiter, UUID, validateWrite } from '@/lib/security/policy';

const requests = new RateLimiter(600,60000);
type Context = {params:Promise<{table:string}>};
async function handle(request:Request, context:Context) {
  try {
    if (request.method !== 'GET') enforceOrigin(request);
    const user = await identity();
    if (!user) throw new HttpError(401,'Sign in required');
    const {table} = await context.params;
    if (!canAccess(user.role,table,request.method)) throw new HttpError(403,'Access denied');
    if (!requests.allow(user.id)) return new Response(JSON.stringify({message:'Too many requests'}),{status:429,headers:{'Content-Type':'application/json','Retry-After':'60','Cache-Control':'no-store'}});
    const query = new URL(request.url).searchParams;
    if (query.toString().length > 4096) throw new HttpError(400,'Query too large');
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (request.method === 'PATCH' && (query.size !== 1 || !UUID.test((query.get('id')??'').replace(/^eq\./,'')) || !query.get('id')?.startsWith('eq.'))) throw new HttpError(400,'A single record ID is required');
      if (request.method === 'POST' && query.size) throw new HttpError(400,'Unexpected query');
      try {body = JSON.stringify(validateWrite(table,request.method,await readJson(request)));}
      catch(error) {if(error instanceof HttpError) throw error;throw new HttpError(400,'Invalid entry. Check the fields and device time.');}
    } else {
      for (const [key,value] of query) {
        if (!['select','order','active','recorded_at','id','limit','offset','client_id'].includes(key) || value.length > 1000) throw new HttpError(400,'Unsupported query');
      }
      if (query.has('select') && !/^(\*|[a-z_]+(?:,[a-z_]+)*)$/.test(query.get('select')!)) throw new HttpError(400,'Only table columns may be selected');
      if (query.has('limit') && !/^\d{1,4}$/.test(query.get('limit')!)) throw new HttpError(400,'Invalid limit');
      if (query.has('offset') && !/^\d{1,7}$/.test(query.get('offset')!)) throw new HttpError(400,'Invalid offset');
    }
    const {url,key} = backendConfig();
    const response = await fetch(`${url}/rest/v1/${table}?${query}`,{
      method:request.method,body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{apikey:key,Authorization:`Bearer ${user.token}`,'Content-Type':'application/json',Prefer:request.method==='PATCH'?'return=representation':'return=minimal'},
    });
    if (!response.ok) {
      const problem = await response.json().catch(()=>({}));
      // A duplicate is only acknowledged after verifying this exact client ID
      // belongs to the account that is replaying its offline entry.
      if (response.status === 409 && problem.code === '23505' && body) {
        const payload = JSON.parse(body);
        if (UUID.test(payload.client_id ?? '')) {
          const check = await fetch(`${url}/rest/v1/${table}?client_id=eq.${payload.client_id}&authenticated_user_id=eq.${user.id}&select=client_id`,{headers:{apikey:key,Authorization:`Bearer ${user.token}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
          const rows = check.ok ? await check.json() : [];
          if (Array.isArray(rows) && rows.length === 1) return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
        }
      }
      if (problem.code === 'P0001') return json({message:'Write limit reached. Retry in a minute.'},429);
      return json({message:response.status === 401 ? 'Sign in required' : 'Unable to save or load this entry',code:'REQUEST_FAILED'},[400,401,403,409,429].includes(response.status)?response.status:502);
    }
    if (request.method === 'PATCH') {
      const updated = await response.json();
      if (!Array.isArray(updated) || updated.length !== 1) throw new HttpError(409,'Record was not updated. Reload and retry.');
      return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
    }
    return new Response(response.status===204?null:await response.text(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}});
  } catch(error) {return failure(error);}
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
