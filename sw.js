// ============================================================
// PROTOTYP DESK — Service Worker v2.0
// GitHub Pages — galeonpro
// ============================================================

const CACHE_NAME = 'prototyp-desk-v2';
const FILES_TO_CACHE = [
  '/galeonpro/',
  '/galeonpro/index.html',
  '/galeonpro/galeon-panel.html',
  '/galeonpro/manifest.json',
  '/galeonpro/config.js'
];

// INSTALL
self.addEventListener('install', event => {
  console.log('[SW] Install v2');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE).catch(() => {});
    })
  );
});

// ACTIVATE — usuń stare cache w tym z Netlify
self.addEventListener('activate', event => {
  console.log('[SW] Activate v2');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Usuwam stary cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// FETCH
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    }).catch(() => fetch(event.request))
  );
});

// TIMER ENGINE
let activeTimers = {};
let timerCheckInterval = null;

self.addEventListener('message', event => {
  const { type, data } = event.data || {};

  switch(type) {
    case 'TIMER_START': {
      const { zid, accumulated } = data;
      activeTimers[zid] = { startTs: Date.now(), accumulated: accumulated || 0 };
      startPeriodicCheck();
      break;
    }
    case 'TIMER_STOP': {
      const { zid } = data;
      delete activeTimers[zid];
      if (Object.keys(activeTimers).length === 0) stopPeriodicCheck();
      break;
    }
    case 'TIMERS_RESTORE': {
      const { timers } = data;
      activeTimers = {};
      if (timers) {
        for (const [zid, timer] of Object.entries(timers)) {
          activeTimers[zid] = timer;
        }
      }
      if (Object.keys(activeTimers).length > 0) startPeriodicCheck();
      break;
    }
    case 'TIMERS_PAUSE_ALL': {
      const now = Date.now();
      for (const [zid, timer] of Object.entries(activeTimers)) {
        timer.accumulated += Math.floor((now - timer.startTs) / 1000);
        timer.startTs = null;
        timer.paused = true;
      }
      stopPeriodicCheck();
      break;
    }
    case 'TIMERS_RESUME_ALL': {
      const now = Date.now();
      for (const [zid, timer] of Object.entries(activeTimers)) {
        if (timer.paused) { timer.startTs = now; timer.paused = false; }
      }
      if (Object.keys(activeTimers).length > 0) startPeriodicCheck();
      break;
    }
    case 'GET_ALL_ELAPSED': {
      const now = Date.now();
      const result = {};
      for (const [zid, timer] of Object.entries(activeTimers)) {
        result[zid] = timer.paused ? timer.accumulated :
          timer.accumulated + Math.floor((now - timer.startTs) / 1000);
      }
      event.source.postMessage({ type: 'ALL_ELAPSED_RESPONSE', data: result });
      break;
    }
  }
});

function startPeriodicCheck() {
  if (timerCheckInterval) return;
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
        clients.forEach(c => c.postMessage({ type: 'TIMER_TICK', data: elapsed }));
      }
    });
  }, 30000);
}

function stopPeriodicCheck() {
  if (timerCheckInterval) { clearInterval(timerCheckInterval); timerCheckInterval = null; }
}
