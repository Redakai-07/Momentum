/* Momentum service worker — offline-first app shell.
 *
 * Strategy:
 *  - Navigations: network-first, cached copy of that exact page as fallback,
 *    then the cached home shell as a last resort. Successful navigations are
 *    cached as they happen, so every visited route works offline.
 *  - Hashed build assets (_next/static, fonts, icons, manifest): cache-first
 *    with a background refresh (stale-while-revalidate). Hashed URLs are
 *    immutable, so this is always safe.
 *  - Everything else same-origin GET: passthrough (cached opportunistically).
 */
const VERSION = "momentum-shell-v1";
const STATIC_PREFIXES = ["/_next/static/", "/icons/", "/fonts/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-512.png", "/icons/icon-192.png", "/icon.svg"]).catch(() => {}),
      ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

const sameOrigin = (url) => url.origin === self.location.origin;

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await refresh);
}

async function handleNavigation(request) {
  const cache = await caches.open(VERSION);
  // Prefer the network; a stored copy of this exact page covers offline.
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort: the cached home shell (the app is local-first once loaded).
    const home = await cache.match("/");
    if (home) return home;
    return new Response("Offline — Momentum needs a connection on first visit.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || !sameOrigin(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Other same-origin GETs are left to the browser's HTTP cache.
});
