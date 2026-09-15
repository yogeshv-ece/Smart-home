/* =====================================================================
   Smart Home Control - Service Worker (sw.js)
   - Caches static app assets for fast loading and offline shell.
   - NEVER caches /api/ endpoints (ESP32 hardware state is always live).
   ===================================================================== */

const CACHE_NAME = "smart-home-shell-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon.svg"
];

// Install: Cache static shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Always bypass cache for hardware API requests
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Hardware requests or non-GET requests MUST always bypass cache
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
    );
    return;
  }

  // Static shell assets: Network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
