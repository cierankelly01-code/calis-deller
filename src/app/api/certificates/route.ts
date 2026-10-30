import { randomUUID } from 'node:crypto';
import { backendConfig, enforceOrigin, failure, HttpError, identity, json } from '@/lib/security/server';
import { CERTIFICATE_PATH, RateLimiter, UUID } from '@/lib/security/policy';

// Staff certificates (personal data): managers only, at both ends. Files go
// to a private Supabase Storage bucket under the shop's id with a random
// name; the training record stores only that path. Storage policies refuse
// anyone but a manager too, so this route is not the only guard.

const BUCKET = 'food-log-certificates';
const MAX_BYTES = 8 * 1024 * 1024;
const uploads = new RateLimiter(30, 60 * 60 * 1000);
const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', magic: b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
  'application/pdf': { ext: 'pdf', magic: b => String.fromCharCode(...b.slice(0, 5)) === '%PDF-' },
};
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([type, t]) => [t.ext, type]));

async function manager() {
  const user = await identity();
  if (!user) throw new HttpError(401, 'Sign in required');
  if (user.role !== 'manager') throw new HttpError(403, 'Managers only');
  return user;
}

async function readBody(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new HttpError(413, 'File too large (8 MB max)');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'File required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(413, 'File too large (8 MB max)'); }
    chunks.push(value);
  }
  if (size === 0) throw new HttpError(400, 'File required');
  return new Uint8Array(Buffer.concat(chunks));
}

export async function POST(request: Request) {
  try {
    enforceOrigin(request);
    const user = await manager();
    if (!uploads.allow(user.id)) throw new HttpError(429, 'Too many uploads. Try again later.');
    const site = new URL(request.url).searchParams.get('site') ?? '';
    if (!UUID.test(site)) throw new HttpError(400, 'Shop required');
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const kind = TYPES[type];
    if (!kind) throw new HttpError(415, 'Use a photo (JPEG, PNG, WebP) or a PDF');
    const body = await readBody(request);
    if (!kind.magic(body)) throw new HttpError(415, 'That file is not what it says it is');
    const path = `${site.toLowerCase()}/${randomUUID()}.${kind.ext}`;
    const { url, key } = backendConfig();
    const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST', body: Buffer.from(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { apikey: key, Authorization: `Bearer ${user.token}`, 'Content-Type': type, 'x-upsert': 'false' },
    });
    if (!response.ok) {
      console.error(`[certificates] upload -> ${response.status}`);
      throw new HttpError(response.status === 403 ? 403 : 502, 'Could not store the certificate');
    }
    return json({ path });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  try {
    const user = await manager();
    const path = new URL(request.url).searchParams.get('path') ?? '';
    if (!CERTIFICATE_PATH.test(path)) throw new HttpError(400, 'Invalid certificate');
    const { url, key } = backendConfig();
    const response = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { apikey: key, Authorization: `Bearer ${user.token}` },
    });
    if (!response.ok) throw new HttpError(response.status === 404 || response.status === 400 ? 404 : 502, 'Certificate not found');
    // The type comes from our own file name, never from storage or the uploader.
    const type = BY_EXT[path.split('.').pop()!];
    return new Response(response.body, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      },
    });
  } catch (error) { return failure(error); }
}
