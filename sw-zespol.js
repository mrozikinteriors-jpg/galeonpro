const CACHE = 'zespol-v7';
// Cache only fonts — HTML zawsze z sieci
const FONT_CACHE = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Inconsolata:wght@300;400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FONT_CACHE).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Airtable API — zawsze sieć
  if (url.includes('api.airtable.com')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response('{"error":"offline"}', { status: 503 })
    ));
    return;
  }

  // HTML — zawsze sieć (no-cache), fallback do cache
  if (url.endsWith('.html') || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() =>
        caches.match(e.request)
      )
    );
    return;
  }

  // Pozostałe (fonty itp.) — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
