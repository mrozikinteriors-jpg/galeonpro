const CACHE_NAME = 'prototyp-desk-v25';
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
    // usunięto c.navigate(c.url) — powodowało błędne odświeżenia
  );
});
self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Nie przechwytuj zasobów apki Zespół — obsługuje je sw-zespol.js
  if (url.includes('zespol') || url.includes('sw-zespol')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)); }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
