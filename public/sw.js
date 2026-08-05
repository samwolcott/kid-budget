const CACHE_NAME = "family-bank-shell-v2";
const APP_ROUTES = ["./", "./parent/", "./kids/judah/", "./kids/max/"];
const STATIC_FILES = [
  "./manifest.webmanifest",
  "./app-icon-192.png",
  "./app-icon-512.png",
];

function appUrl(path) {
  return new URL(path, self.registration.scope).href;
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const routeUrls = APP_ROUTES.map(appUrl);

  await cache.addAll([...routeUrls, ...STATIC_FILES.map(appUrl)]);

  const pages = await Promise.all(
    routeUrls.map((url) => cache.match(url).then((response) => response?.text())),
  );
  const assetUrls = new Set();

  for (const page of pages) {
    if (!page) continue;
    for (const match of page.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = new URL(match[1], self.registration.scope);
      if (url.origin === self.location.origin && url.pathname.includes("/_astro/")) {
        assetUrls.add(url.href);
      }
    }
  }

  await Promise.all(
    [...assetUrls].map((url) => cache.add(url).catch(() => undefined)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("family-bank-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (
          await caches.match(request)
          ?? await caches.match(appUrl("./"))
        )),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
