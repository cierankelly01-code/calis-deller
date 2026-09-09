import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Preserve the typed query builder; all requests use the authenticated,
// same-origin server boundary. No backend key or token enters this bundle.
export const supabase = createClient<Database>('https://food-log.invalid', 'unused-public-placeholder', {
  auth: {persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global: {fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.startsWith('/rest/v1/')) throw new Error('Unsupported operation');
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.delete('apikey');
    const response = await fetch(`/api/data/${url.pathname.slice('/rest/v1/'.length)}${url.search}`, {...init,headers,credentials:'same-origin',cache:'no-store'});
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('food-log-sign-in-required'));
    return response;
  }},
});
