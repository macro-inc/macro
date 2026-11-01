/**
 * Retire the former app-shell and asset cache worker. Keep this URL available
 * so installed workers can update, release their caches, and unregister.
 * New app builds do not register a service worker.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith('macro-shell-') ||
              name.startsWith('macro-assets-')
          )
          .map((name) => caches.delete(name))
      );
      await self.registration.unregister();
    })()
  );
});
