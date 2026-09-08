// ELIZA service worker — installable PWA shell + smart asset caching.
//
// Bump CACHE_VERSION whenever this file's *caching logic* changes (not on
// every app deploy — Vite's content-hashed /assets/* filenames already make
// ordinary deploys cache-safe without touching this file; see the
// "Update lifecycle" note below for why).
const CACHE_VERSION = 'v5';
const STATIC_CACHE = `eliza-static-${CACHE_VERSION}`;
const PAGES_CACHE = `eliza-pages-${CACHE_VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE];

// Precached at install time so the offline fallback works even on a first
// visit that never completed a network fetch.
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Intentionally no self.skipWaiting() here — the new worker waits until
  // the client explicitly asks it to take over (see the 'message' handler
  // below). registerSW.ts sends that message as soon as it detects a
  // waiting worker, so in practice the update is still automatic; the
  // message hop just gives us one safe place to add a user-visible pause
  // later without touching this file again.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isImmutableAsset(url) {
  // Vite content-hashes everything under /assets/ — the filename itself
  // changes whenever the content does, so caching these forever is safe.
  return url.pathname.startsWith('/assets/');
}

function isNeverCache(url) {
  // Clinical data, AI calls, auth, and any other dynamic API traffic must
  // never be served from cache — always hit the network, and never fall
  // back to a stale cached response if the network fails.
  return url.pathname.startsWith('/api/');
}

function isStaticBrandAsset(url) {
  return (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/splash/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon-32.png' ||
    url.pathname === '/favicon-16.png'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (Firestore, Firebase Auth, OpenAI, Gemini, Twilio, fonts,
  // etc.): never intercept. Letting the browser handle these natively is
  // the simplest guarantee that no clinical/auth traffic is ever cached by
  // this worker.
  if (url.origin !== self.location.origin) return;

  if (isNeverCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (isStaticBrandAsset(url)) {
    // Stale-while-revalidate: instant from cache, refreshed in background.
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    // Network-first: a deploy's new index.html references new hashed asset
    // URLs, so we always want the freshest HTML when online. Offline, fall
    // back to a previously-visited copy of this exact page, then to the
    // branded offline shell as a last resort.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(PAGES_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(PAGES_CACHE);
          const cached = await cache.match(request);
          return cached || caches.match('/offline.html');
        })
    );
    return;
  }

  // Everything else (other same-origin GETs): network-first with a cache
  // fallback, so occasional offline hiccups degrade gracefully without
  // ever serving something we're not confident is safe to reuse.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(PAGES_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Push notification scaffold — no campaign backend wired up yet, but the
// worker is ready the moment one exists (VAPID subscription + a server-side
// sender). Falls back to generic branded copy if the push payload isn't
// JSON with the expected shape.
self.addEventListener('push', (event) => {
  let data = { title: 'ELIZA', body: 'Você tem uma nova notificação.' };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
