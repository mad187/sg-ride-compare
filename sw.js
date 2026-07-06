// Cache-first service worker for the app shell so the app opens
// instantly from the home screen. API calls (other origins) pass through.
const VERSION = 'trc-v5';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/geocode.js',
  './js/route.js',
  './js/fares.js',
  './js/deeplinks.js',
  './fares.json',
  './providers.json',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // no-cache: bypass the HTTP cache so a new version never installs
  // stale assets (GitHub Pages serves with max-age=600)
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'no-cache' })))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // let API calls hit the network
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
    )
  );
});
