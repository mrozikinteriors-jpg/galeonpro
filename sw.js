// ============================================================
// PROTOTYP DESK — Service Worker v1.0
// Obsługuje timery w tle gdy aplikacja jest zamknięta
// ============================================================

const CACHE_NAME = 'prototyp-desk-v8';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ============================================================
// INSTALL — cache plików aplikacji
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE).catch(() => {
        // Ignoruj błędy cache — aplikacja zadziała bez nich
      });
    })
  );
  self.skipWaiting();
});

// ============================================================
// ACTIVATE — usuń stare cache
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ============================================================
// FETCH — serwuj z cache jeśli dostępne
// ============================================================
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    }).catch(() => fetch(event.request))
  );
});

// ============================================================
// TIMER ENGINE w tle
// Przechowuje aktywne timery i ich czasy startu
// ============================================================
let activeTimers = {}; // { zid: { startTs, accumulated } }
let timerCheckInterval = null;

// Odbierz wiadomości od aplikacji
self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  switch(type) {

    case 'TIMER_START': {
      // Aplikacja informuje że timer wystartował
      const { zid, accumulated } = data;
      activeTimers[zid] = {
        startTs: Date.now(),
        accumulated: accumulated || 0
      };
      console.log('[SW] Timer start:', zid);
      startPeriodicCheck();
      break;
    }

    case 'TIMER_STOP': {
      // Aplikacja informuje że timer zatrzymany
      const { zid } = data;
      delete activeTimers[zid];
      console.log('[SW] Timer stop:', zid);
      if (Object.keys(activeTimers).length === 0) {
        stopPeriodicCheck();
      }
      break;
    }

    case 'TIMER_SYNC': {
      // Aplikacja pyta o aktualny czas timerów (po powrocie do apki)
      const now = Date.now();
      const result = {};
      for (const [zid, timer] of Object.entries(activeTimers)) {
        result[zid] = {
          elapsed: timer.accumulated + Math.floor((now - timer.startTs) / 1000)
        };
      }
      event.source.postMessage({ type: 'TIMER_SYNC_RESPONSE', data: result });
      break;
    }

    case 'TIMERS_RESTORE': {
      // Aplikacja wysyła listę aktywnych timerów przy starcie
      const { timers } = data;
      activeTimers = {};
      if (timers) {
        for (const [zid, timer] of Object.entries(timers)) {
          activeTimers[zid] = timer;
        }
      }
      console.log('[SW] Timers restored:', Object.keys(activeTimers).length);
      if (Object.keys(activeTimers).length > 0) startPeriodicCheck();
      break;
    }

    case 'TIMERS_PAUSE_ALL': {
      // Pauza globalna — zatrzymaj wszystkie timery w SW
      const now = Date.now();
      for (const [zid, timer] of Object.entries(activeTimers)) {
        timer.accumulated += Math.floor((now - timer.startTs) / 1000);
        timer.startTs = null;
        timer.paused = true;
      }
      stopPeriodicCheck();
      console.log('[SW] All timers paused');
      break;
    }

    case 'TIMERS_RESUME_ALL': {
      // Wznowienie po globalnej pauzie
      const now = Date.now();
      for (const [zid, timer] of Object.entries(activeTimers)) {
        if (timer.paused) {
          timer.startTs = now;
          timer.paused = false;
        }
      }
      if (Object.keys(activeTimers).length > 0) startPeriodicCheck();
      console.log('[SW] All timers resumed');
      break;
    }

    case 'GET_ALL_ELAPSED': {
      // Pobierz czas wszystkich timerów
      const now = Date.now();
      const result = {};
      for (const [zid, timer] of Object.entries(activeTimers)) {
        if (timer.paused) {
          result[zid] = timer.accumulated;
        } else {
          result[zid] = timer.accumulated + Math.floor((now - timer.startTs) / 1000);
        }
      }
      event.source.postMessage({ type: 'ALL_ELAPSED_RESPONSE', data: result });
      break;
    }
  }
});

function startPeriodicCheck() {
  if (timerCheckInterval) return;
  // Co 30 sekund wyślij ping do aktywnych klientów
  timerCheckInterval = setInterval(() => {
    self.clients.matchAll().then(clients => {
      if (clients.length === 0) return;
      const now = Date.now();
      const elapsed = {};
      for (const [zid, timer] of Object.entries(activeTimers)) {
        if (!timer.paused && timer.startTs) {
          elapsed[zid] = timer.accumulated + Math.floor((now - timer.startTs) / 1000);
        }
      }
      if (Object.keys(elapsed).length > 0) {
        clients.forEach(client => {
          client.postMessage({ type: 'TIMER_TICK', data: elapsed });
        });
      }
    });
  }, 30000);
}

function stopPeriodicCheck() {
  if (timerCheckInterval) {
    clearInterval(timerCheckInterval);
    timerCheckInterval = null;
  }
}
