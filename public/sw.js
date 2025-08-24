self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { clients.claim(); });
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.pathname.startsWith('/icons/') || url.pathname.endsWith('/manifest.json')) {
    event.respondWith(
      caches.open('su-static-v1').then(cache =>
        cache.match(req).then(hit => hit || fetch(req).then(resp => { cache.put(req, resp.clone()); return resp; }))
      )
    );
  }
});