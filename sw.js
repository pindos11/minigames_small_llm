const CACHE_NAME = 'match3-pwa-v1';
const ASSETS_TO_CACHE = [
    './',
    './match3.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// --- Install: cache everything ---
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).catch(() => {
            // If any asset fails (e.g. icon not found yet), continue anyway
        })
    );
    // Skip the waiting phase so the SW activates immediately
    self.skipWaiting();
});

// --- Activate: clean old caches ---
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// --- Fetch: serve from cache, fall back to network ---
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            // Not in cache — fetch from network
            return fetch(event.request).then((response) => {
                // Cache the response for next time
                if (response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // Totally offline — serve the game HTML as a last resort
                if (event.request.destination === 'document') {
                    return caches.match('./match3.html');
                }
            });
        })
    );
});
