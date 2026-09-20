/* CouponBot PWA shell cache. Bump VERSION to force update. */
const VERSION = "v4";
const CACHE = "couponbot-" + VERSION;
const CORE = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only cache same-origin shell; Puter/CDN/claim site/backend stay network-only.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/api/")) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => caches.match("./index.html"))
    )
  );
});
