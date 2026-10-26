// Cache-as-you-go so the game opens offline after the first visit.
const C = 'gridlock-v2';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/\/radio\/.+\.(mp3|m4a|ogg|wav|aac|flac)$/i.test(e.request.url)) return;   // songs stream straight from the network (big, range-requested)
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(C).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
