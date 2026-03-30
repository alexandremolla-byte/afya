// AFYA Service Worker — v1
// Strategy:
//   App shell (HTML, fonts, icons) → Cache-first
//   Supabase / Netlify functions  → Network-first (never cache API calls)

const CACHE_NAME  = "afya-v1";
const APP_SHELL   = [
  "/app.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── Install: pre-cache app shell ───────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: route requests ─────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept: Supabase, Netlify functions, Paystack, external CDNs
  if (
    url.hostname.includes("supabase.co")     ||
    url.pathname.startsWith("/.netlify/")    ||
    url.hostname.includes("paystack")        ||
    url.hostname.includes("unpkg.com")       ||
    url.hostname.includes("googleapis.com")  ||
    url.hostname.includes("cdnjs.cloudflare")
  ) {
    return; // fall through to network
  }

  // App shell — cache-first, fall back to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful same-origin GET responses
        if (
          response.ok &&
          request.method === "GET" &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return cached app.html for navigation requests
        if (request.mode === "navigate") {
          return caches.match("/app.html");
        }
      });
    })
  );
});
