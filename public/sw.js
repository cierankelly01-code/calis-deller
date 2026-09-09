// Cache immutable assets only. Never cache HTML, auth or food records.
const CACHE_NAME = 'food-log-assets-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('calis-deller-shell-') || (key.startsWith('food-log-assets-') && key !== CACHE_NAME)).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || !url.pathname.startsWith('/_next/static/'))return;
  event.respondWith(caches.match(request).then(async cached => {
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok) {const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());}
    return response;
  }));
});
