const CACHE_NAME = 'swim-store-manager-v5';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-sync.js',
  './firebase-integration.js',
  './manifest.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

const FIREBASE_CDN_ORIGIN = 'https://www.gstatic.com';
const FIREBASE_SDK_PREFIX = '/firebasejs/13.4.0/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || !response.ok) return response;

        const requestUrl = new URL(event.request.url);
        const isAppAsset = requestUrl.origin === self.location.origin;
        const isFirebaseSdk = requestUrl.origin === FIREBASE_CDN_ORIGIN
          && requestUrl.pathname.startsWith(FIREBASE_SDK_PREFIX)
          && event.request.destination === 'script';

        if (isAppAsset || isFirebaseSdk) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        const requestUrl = new URL(event.request.url);
        if (requestUrl.origin === self.location.origin) {
          return caches.match('./index.html');
        }
        return new Response('', {
          status: 503,
          statusText: 'Offline and not cached',
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
        });
      });
    })
  );
});
