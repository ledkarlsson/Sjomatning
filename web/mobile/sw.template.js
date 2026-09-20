// The build substitutes a content hash and the complete list of bundled files.
const CACHE = 'sjomatning-mobile-__BUILD__';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))); });
// New versions wait for open app windows to close, keeping a consistent shell.
self.addEventListener('activate', event => { event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('sjomatning-mobile-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  let path=url.pathname;
  if(path==='/mobile'||path==='/mobile/index.html')path='/mobile/';
  if(path==='/mobile/chart.html')path='/mobile/chart';
  if(!ASSETS.includes(path))return; // API responses and credentials are never cached.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),saved=await cache.match(path);
    return saved || fetch(event.request);
  })());
});
