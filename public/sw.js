const CACHE_NAME = "eastport-last-good-v1";
const API_DATA = "/api/data";
const APP_SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.url.includes(API_DATA)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(API_DATA, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(API_DATA);
          if (cached) return cached;
          return new Response(JSON.stringify({ message: "Offline and no cached data available." }), {
            headers: { "Content-Type": "application/json" },
            status: 503
          });
        })
    );
  }
});
