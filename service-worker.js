/* service-worker.js - BLAPL Loyalty App */
const APP_VERSION = 'v1';
const APP_SHELL_CACHE = `blapl-shell-${APP_VERSION}`;
// Deployed under /bla-loyalty-app/ (GitHub Pages). All asset paths relative so they resolve within scope.
const CORE_ASSETS = [
  'index.html',
  'manifest.json',
  'favicon/favicon.ico',
  'favicon/apple-touch-icon.png',
  'favicon/web-app-manifest-192x192.png',
  'favicon/web-app-manifest-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('blapl-shell-') && k !== APP_SHELL_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Strategy:
//  - HTML (navigate) requests: network-first, fallback to cached index.html
//  - Other GET: cache-first, then background update (stale-while-revalidate lite)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(r => {
          const copy = r.clone();
          caches.open(APP_SHELL_CACHE).then(c => c.put('index.html', copy));
          return r;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // Background refresh with single clone
        fetch(req).then(r2 => {
          if (r2 && r2.ok) {
            const cacheCopy = r2.clone();
            caches.open(APP_SHELL_CACHE).then(c => c.put(req, cacheCopy));
          }
        }).catch(()=>{});
        return cached;
      }
      return fetch(req).then(r => {
        if (r && r.ok) caches.open(APP_SHELL_CACHE).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => {
        if (req.destination === 'document') return caches.match('index.html');
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

