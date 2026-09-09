import { NextRequest, NextResponse } from 'next/server';

export function proxy(request:NextRequest) {
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const dev=process.env.NODE_ENV!=='production';
  const policy=[
    "default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}`,
    "style-src 'self' 'unsafe-inline'","img-src 'self' blob: data:","font-src 'self'",
    `connect-src 'self'${dev?' ws:':''}`,"worker-src 'self'","object-src 'none'",
    "base-uri 'none'","form-action 'self'","frame-ancestors 'none'",
    ...(dev?[]:['upgrade-insecure-requests']),
  ].join('; ');
  const headers=new Headers(request.headers);
  headers.set('x-nonce',nonce);
  headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',policy);
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|api/|sw.js|icon|apple-icon|manifest.webmanifest|favicon.ico).*)']};
