const CACHE = 'slothodoro-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './favicon.svg',
  './assets/sloth.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => cached);
    })
  );
});
