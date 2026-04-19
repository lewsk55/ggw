// Golf Gone Wrong — service worker
//
// Strategy: network-first for the HTML (so updates show up fast), cache-first
// for the heavier Three.js CDN asset (it never changes for a given r128 URL).
//
// Cache name includes a version string. Bump CACHE_VERSION when you want to
// force users to drop stale caches on next launch. In practice you rarely need
// to — the network-first strategy on index.html means updates propagate
// within one reload — but if CDN URLs change or you add a new cached URL,
// bump this to force cleanup.
const CACHE_VERSION = 'ggw-v1';
const CACHE_NAME = `ggw-cache-${CACHE_VERSION}`;

// URLs we want to keep around for offline use. Three.js is the big one because
// it's loaded from a CDN and we don't want a network request every launch.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
];

self.addEventListener('install', (event) => {
  // Pre-cache core assets so first offline load works.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use addAll with a catch so one failure doesn't block the whole install.
      // Fetch each individually and ignore failures.
      return Promise.all(PRECACHE_URLS.map((url) =>
        fetch(url, { mode: 'no-cors' }).then((resp) => cache.put(url, resp)).catch(() => {})
      ));
    })
  );
  // Take over immediately on install — we don't want two SW generations fighting.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Purge old cache versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ggw-cache-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs. POSTs etc. shouldn't be cached.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Strategy selection:
  // - HTML (the game itself): network-first, fall back to cache if offline.
  //   This ensures the user sees updates as soon as they reload with a
  //   connection, but still works offline against whatever was cached last.
  // - Everything else (Three.js CDN, fonts, manifest): cache-first.
  const isHtml =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/');

  if (isHtml) {
    event.respondWith(
      fetch(req).then((resp) => {
        // Clone + store successful responses for offline.
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for static assets (CDN JS, fonts, manifest).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached); // nothing to return — let it fail naturally
    })
  );
});
