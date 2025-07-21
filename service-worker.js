/* service-worker.js - BLAPL Loyalty App */
const APP_VERSION = 'v1';
const APP_SHELL_CACHE = `blapl-shell-${APP_VERSION}`;
// Deployed under /bla-loyalty-app/ (GitHub Pages). All asset paths relative so they resolve within scope.
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon/apple-touch-icon.png',
  '/favicon/web-app-manifest-192x192.png',
  '/favicon/web-app-manifest-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== APP_SHELL_CACHE).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  // HTML pages: network-first, fall back to cache
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(response => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put('index.html', copy));
          return response;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // Other GET requests: stale-while-revalidate
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_SHELL_CACHE).then(cache => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => {
          if (req.destination === 'document') return caches.match('index.html');
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      return cached || networkFetch;
    })
  );
});
