import type { Page } from '@playwright/test';

/**
 * Loads the fixture's own modules through Playwright instead of the browser's
 * sockets, and lets no other request leave the machine. A machine whose
 * network interfaces change while a page loads (a container network coming
 * up) makes Chrome abort every module request in flight with
 * ERR_NETWORK_CHANGED and the page stays blank; requests made from Node are
 * not aborted. The app addresses its services at their hosted gateway, so a
 * request no test answers is refused here instead of reaching it. Call it
 * before the routes that answer the services: routes added later win.
 */
export async function serveFromNode(page: Page) {
  // Sockets do not pass through `page.route`.
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route(
    (url) => /^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.route(
    (url) => url.protocol === 'http:' && url.hostname === '127.0.0.1',
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      for (const name of [
        'content-encoding',
        'content-length',
        'transfer-encoding',
      ])
        delete headers[name];
      await route.fulfill({
        status: response.status(),
        headers,
        body: await response.body(),
      });
    }
  );
}

/**
 * Opens a fixture page, again if Vite answered a module with 504: it does
 * that while it re-bundles a dependency it had not seen, and expects the page
 * to reload over its socket.
 */
export async function openFixture(page: Page, path: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let stale = false;
    const onResponse = (response: { status: () => number }) => {
      if (response.status() === 504) stale = true;
    };
    page.on('response', onResponse);
    await page.goto(path, { waitUntil: 'networkidle' });
    page.off('response', onResponse);
    if (!stale) return;
  }
  throw new Error(`Vite kept re-bundling dependencies for ${path}`);
}
