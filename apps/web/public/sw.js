/**
 * Macro web app service worker (scope /app/). Registered by
 * src/lib/service-worker/register.ts in production web builds only.
 *
 * - Navigations get the cached app shell (index.html) immediately and
 *   revalidate it in the background, so a new tab skips the HTML round trip.
 *   A shell is cached only after its entry JS and CSS are, so a cached shell
 *   can always boot.
 * - Content-hashed assets are immutable: served cache-first from Cache
 *   Storage, tagged with the build that fetched them, and pruned to the
 *   current and previous builds.
 * - When revalidation finds a newer build, open tabs get a
 *   `macro:newer-build` message so a tab still on the cached build can move
 *   to it.
 *
 * Kill switch: ship a sw.js whose install handler calls
 * `self.registration.unregister()`; a client also unregisters it when its
 * localStorage `macro:sw` is `off`.
 */

const SHELL_CACHE = 'macro-shell-v1';
const ASSET_CACHE = 'macro-assets-v1';
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL_KEY = `${SCOPE_PATH}__shell`;
const BUILD_HEADER = 'x-macro-build';
const ASSETS_HEADER = 'x-macro-shell-assets';

// Vite output names end in an 8-character base64url content hash.
const HASHED_ASSET =
  /-(?=[A-Za-z0-9_-]*[A-Z0-9_])[A-Za-z0-9_-]{8}\.(?:js|css|wasm|woff2?|ttf|svg|png|jpe?g|webp|glb)$/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Warm the shell for the next tab; a failure only means a cold next tab.
  event.waitUntil(refreshShell(new Request(SCOPE_PATH)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith('macro-') && !keep.has(name)) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PATH)) return;

  if (request.mode === 'navigate') {
    // Mirror the routing lambda: paths that look like files are not the app.
    const leaf = url.pathname.split('/').pop() ?? '';
    if (leaf.includes('.') && !url.pathname.includes('@')) return;
    event.respondWith(serveShell(event));
  } else if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(serveAsset(request));
  }
});

async function serveShell(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(SHELL_KEY);
  const refreshed = refreshShell(event.request).catch(() => undefined);
  if (cached && (await shellAssetsCached(cached))) {
    event.waitUntil(refreshed);
    return cached;
  }
  // No bootable shell yet: wait for the network, falling back to whatever
  // is cached when offline.
  const response = await refreshed;
  return response ?? cached ?? Response.error();
}

/** Fetches index.html, caches it as the shell once its entry is cached, and returns the network response. */
async function refreshShell(request) {
  const response = await fetch(request, { cache: 'no-store' });
  if (!response.ok || response.redirected) return response;
  if (!response.headers.get('content-type')?.includes('text/html')) {
    return response;
  }
  const html = await response.clone().text();
  const build = /<meta name="macro-bundle-build" content="(\d+)"/.exec(
    html
  )?.[1];
  if (!build) return response;

  const cache = await caches.open(SHELL_CACHE);
  const current = await cache.match(SHELL_KEY);
  const currentBuild = current?.headers.get(BUILD_HEADER);
  if (currentBuild === build && (await shellAssetsCached(current))) {
    return response;
  }

  // The routing lambda adds a per-document <title>; the shell serves every route.
  const shell = html.replace(/<title data-sm="">[\s\S]*?<\/title>/, '');
  const assets = entryAssets(shell);
  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all(
    assets.map(async (path) => {
      if (await assetCache.match(path)) return;
      const assetResponse = await fetch(path);
      if (!assetResponse.ok) throw new Error(`Failed to cache ${path}`);
      await assetCache.put(path, tagged(assetResponse, build));
    })
  );
  // Keep the document's own headers (COOP for login popups, frame options).
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'date', 'age']) {
    headers.delete(name);
  }
  headers.set(BUILD_HEADER, build);
  headers.set(ASSETS_HEADER, assets.join(' '));
  await cache.put(SHELL_KEY, new Response(shell, { headers }));

  if (currentBuild && Number(build) > Number(currentBuild)) {
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: 'macro:newer-build', build });
    }
  }
  if (currentBuild !== build) {
    await pruneAssets(new Set([build, currentBuild ?? build]));
  }
  return response;
}

/** The entry module, its preloads, and stylesheets referenced by a shell. */
function entryAssets(html) {
  const paths = new Set();
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g
  )) {
    const tag = match[0];
    const isEntry =
      tag.startsWith('<script') ||
      /\brel="(?:stylesheet|modulepreload)"/.test(tag);
    const path = new URL(match[1], self.location.origin).pathname;
    if (isEntry && HASHED_ASSET.test(path)) paths.add(path);
  }
  return [...paths];
}

async function shellAssetsCached(shell) {
  const assets = shell.headers.get(ASSETS_HEADER)?.split(' ') ?? [];
  if (assets.length === 0) return false;
  const assetCache = await caches.open(ASSET_CACHE);
  const hits = await Promise.all(assets.map((path) => assetCache.match(path)));
  return hits.every(Boolean);
}

async function serveAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const shell = await (await caches.open(SHELL_CACHE)).match(SHELL_KEY);
    const build = shell?.headers.get(BUILD_HEADER) ?? '';
    cache.put(request, tagged(response.clone(), build)).catch(() => {});
  }
  return response;
}

/** Copies a response with the build that fetched it, for pruning. */
function tagged(response, build) {
  const headers = new Headers(response.headers);
  headers.set(BUILD_HEADER, build);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Drops cached assets fetched by builds other than `keep`. */
async function pruneAssets(keep) {
  const cache = await caches.open(ASSET_CACHE);
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!keep.has(response?.headers.get(BUILD_HEADER) ?? '')) {
      await cache.delete(request);
    }
  }
}
