/* WeekendGo service worker — offline tile & asset caching */
const TILES = "wg-tiles-v2";
const APP = "wg-app-v8";
const DATA = "wg-data-v4";
const ALL = [TILES, APP, DATA];
// NOTE: cdn.jsdelivr.net is intentionally NOT cached here — the MapLibre
// script/css use Subresource Integrity (SRI), and an opaque cached response
// can't be validated by SRI (breaks the map). Let the browser load + HTTP-cache
// those directly with CORS.
const TILE_HOSTS = [
  "server.arcgisonline.com",
  "s3.amazonaws.com",
  "glyphs.geolonia.com",
  "fonts.gstatic.com",
  "fonts.googleapis.com",
];
const MAX_TILES = 1500;
let putCount = 0;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(APP).then((c) =>
      c.addAll([
        "./",
        "./index.html",
        "./css/main.css",
        "./js/app.js",
        "./js/i18n.js",
        "./assets/logo-full.webp",
        "./assets/logo-mark.webp",
      ]).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !ALL.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) {
    // FIFO: drop the oldest tenth
    const drop = keys.slice(0, Math.ceil(MAX_TILES / 10));
    await Promise.all(drop.map((k) => c.delete(k)));
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // remote tiles / fonts / cdn: cache-first (effectively immutable)
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === "opaque")) {
          c.put(req, res.clone());
          if (++putCount % 50 === 0) trimTiles();
        }
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // data: network-first, cache fallback (so updates always win when online)
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // app shell: network-first, cache only when offline (stale-while-revalidate showed returning
  // visitors the previous release after every deploy). Pass the request through untouched:
  // re-issuing it with a RequestInit (e.g. {cache:"no-cache"}) broke navigations and the
  // lazily imported 3D-print module in Chrome.
  e.respondWith(
    caches.open(APP).then((c) =>
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        })
        .catch(() => c.match(req).then((hit) => hit || Promise.reject(new Error("offline"))))
    )
  );
});
