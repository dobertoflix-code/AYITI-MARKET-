// ============ AYITI MARKET — SERVICE WORKER ============
// Estrateji: "network-first" pou paj prensipal la (pou jwenn dènye vèsyon),
// "cache-first" pou ikon/asè estatik. Sa evite paj la rete bloke sou yon vèsyon vye.

const CACHE_NAME = 'ayiti-market-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-256.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/og-image.jpg',
  '/404.html'
];

// ============ INSTALL: pre-cache asè estatik ============
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ============ ACTIVATE: netwaye ansyen cache ============
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ============ FETCH ============
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Sote requests ki pa GET (POST/PUT/DELETE — egzanp API Supabase/backend)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Pa entèsepte apèl API/Supabase — yo toujou bezwen dènye done an dirèk
  if (
    url.origin.includes('supabase.co') ||
    url.origin.includes('onrender.com') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Navigasyon (chajman paj HTML): "network-first" pou jwenn dènye vèsyon,
  // ak fallback sou cache si pa gen koneksyon.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // Lòt asè (ikon, images, fonts, CSS/JS si genyen): "cache-first" ak rafrechi an background
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// ============ PUSH NOTIFICATIONS ============
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: 'Ayiti Market', body: event.data.text() }; }

  const { title = 'Ayiti Market', body = 'Ou gen yon nouvo mesaj', icon = '/icons/icon-192.png', badge = '/icons/icon-96.png', url = '/messages.html' } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
      vibrate: [200, 100, 200],
      requireInteraction: false,
      tag: 'ayiti-market-message', // Ranplase notifikasyon ansyen pou pa akimile
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/messages.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si paj la deja ouvè, ba li fòkis
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Sinon, ouvè yon nouvo fenèt
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
