const CACHE_NAME = 'swim-store-manager-v13-management-tools-20261125';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-sync.js',
  './auth-persistence-fix.js',
  './firebase-integration.js',
  './app-enhancements.js',
  './app-management-tools.js',
  './manifest.webmanifest',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

const FIREBASE_CDN_ORIGIN = 'https://www.gstatic.com';
const FIREBASE_SDK_PREFIX = '/13.4.0/';
const FIREBASE_SDK_URLS = [
  'https://www.gstatic.com/13.4.0/firebase-app-compat.js',
  'https://www.gstatic.com/13.4.0/firebase-auth-compat.js',
  'https://www.gstatic.com/13.4.0/firebase-database-compat.js'
];

async function cacheFirebaseSdk(cache) {
  await Promise.all(FIREBASE_SDK_URLS.map(async (url) => {
    try {
      const request = new Request(url, { mode: 'no-cors' });
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response);
      }
    } catch (error) {
      console.warn('Firebase SDK pre-cache skipped:', url, error);
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_FILES);
        await cacheFirebaseSdk(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response) return response;
        const requestUrl = new URL(event.request.url);
        const isAppAsset = requestUrl.origin === self.location.origin;
        const isFirebaseSdk = requestUrl.origin === FIREBASE_CDN_ORIGIN
          && requestUrl.pathname.startsWith(FIREBASE_SDK_PREFIX)
          && event.request.destination === 'script';
        if ((isAppAsset && response.ok) || (isFirebaseSdk && (response.ok || response.type === 'opaque'))) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      }).catch(() => {
        const requestUrl = new URL(event.request.url);
        if (requestUrl.origin === self.location.origin) return caches.match('./index.html');
        return new Response('', {
          status: 503,
          statusText: 'Offline and not cached',
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
        });
      });
    })
  );
});
