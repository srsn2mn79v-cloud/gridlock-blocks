// Cache-as-you-go so the game opens offline after the first visit.
const C = 'gridlock-v3';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));      // old caches go
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/\/radio\/.+\.(mp3|m4a|ogg|wav|aac|flac)$/i.test(e.request.url)) return;   // songs stream straight from the network (big, range-requested)
  const u = new URL(e.request.url), page = e.request.mode === 'navigate' || /\.(html|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/') || u.pathname.endsWith('sw.js');
  // the page itself always comes fresh from the network (the browser's own HTTP cache could hand a phone yesterday's copy); only if offline does the cached one open
  e.respondWith(fetch(page ? new Request(e.request, { cache: 'no-store' }) : e.request).then(r => { const c = r.clone(); caches.open(C).then(k => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
