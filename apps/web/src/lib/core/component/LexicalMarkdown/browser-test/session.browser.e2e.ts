import { type BrowserContext, expect, type Page, test } from '@playwright/test';

function local(value: string) {
  const host = new URL(value).hostname;
  return (
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')
  );
}

async function isolate(context: BrowserContext) {
  await context.route('**/*', (route) =>
    local(route.request().url()) ? route.continue() : route.abort()
  );
  await context.routeWebSocket(
    (url) => !local(String(url)),
    (socket) => socket.close()
  );
}

async function navigateWithinApp(page: Page, path: string) {
  // Exercise the router's public same-origin link handler while keeping its shell loaded.
  await page.evaluate((href) => {
    const link = document.createElement('a');
    link.href = href;
    document.body.append(link);
    link.click();
    link.remove();
  }, path);
}

const body = (page: Page) =>
  page.getByRole('textbox', { name: 'Document content', exact: true });

async function flushTelemetry(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/packages/observability/src/index.ts'));
    if (!moduleUrl) throw new Error('Observability module was not loaded');
    const { Telemetry } = await import(/* @vite-ignore */ moduleUrl);
    await Telemetry.flush();
  });
}

test('document model selection, durable typing, reconnect and offline reopen', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  const email = process.env.EDITOR_SESSION_LOGIN_EMAIL;
  const documentId = process.env.EDITOR_SESSION_DOCUMENT_ID;
  test.skip(
    !baseURL || !email || !documentId,
    'Requires an isolated seeded stack and explicit synthetic persona/document.'
  );
  if (!baseURL || !email || !documentId || !local(baseURL))
    throw new Error('Local stack configuration required');
  await isolate(context);
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('document_session_wasm'))
      assets.push(new URL(request.url()).pathname);
  });
  await page.goto(`${baseURL}/app/login?email=${encodeURIComponent(email)}`);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(assets).toEqual([]);
  await navigateWithinApp(page, `/app/md/${encodeURIComponent(documentId)}`);

  if (info.project.name === 'flag-off') {
    await expect(
      page
        .locator('[data-lexical-editor="true"][contenteditable="true"]')
        .last()
    ).toBeVisible();
    expect(assets).toEqual([]);
    await info.attach('session-assets', {
      body: JSON.stringify(assets),
      contentType: 'application/json',
    });
    return;
  }
  await expect(body(page)).toHaveAttribute('data-lexical-key', '0', {
    timeout: 60_000,
  });
  expect(assets.some((asset) => asset.endsWith('.wasm'))).toBe(true);
  const marker = ` session-${crypto.randomUUID()}`;
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(marker);
  await expect(body(page)).toContainText(marker);

  // Offline admission deliberately requires a persisted base, not metadata or WAL alone.
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          if (
            !(await indexedDB.databases()).some(
              (db) => db.name === 'macro-document-snapshots'
            )
          )
            return false;
          return new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('macro-document-snapshots');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction('snapshots', 'readonly');
              const snapshot = tx.objectStore('snapshots').get(id);
              snapshot.onsuccess = () =>
                resolve(snapshot.result?.snapshot?.byteLength > 0);
              snapshot.onerror = () => reject(snapshot.error);
              tx.oncomplete = () => db.close();
            };
          });
        }, documentId),
      { timeout: 30_000 }
    )
    .toBe(true);
  await flushTelemetry(page);

  await context.setOffline(true);
  const offline = `${marker}-offline`;
  await page.keyboard.type(offline);
  await expect(body(page)).toContainText(offline);
  // Reopen in the resident shell: the development server has no offline app shell.
  await navigateWithinApp(page, '/app/home');
  await expect(body(page)).toHaveCount(0);
  await navigateWithinApp(page, `/app/md/${encodeURIComponent(documentId)}`);
  await expect(body(page)).toHaveAttribute('data-lexical-key', '0', {
    timeout: 30_000,
  });
  await expect(body(page)).toContainText(offline);
  await context.setOffline(false);
  const reconnected = `${marker}-reconnected`;
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(reconnected);
  await expect(body(page)).toContainText(reconnected);

  // A fresh context has neither the writer's IndexedDB WAL nor its BroadcastChannel.
  const reader = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: await context.storageState(),
  });
  try {
    await isolate(reader);
    const other = await reader.newPage();
    await other.goto(`${baseURL}/app/md/${encodeURIComponent(documentId)}`);
    await expect(body(other)).toContainText(reconnected, { timeout: 60_000 });
    await expect(body(other)).toContainText(offline);
  } finally {
    await reader.close();
  }
  await info.attach('session-assets', {
    body: JSON.stringify(assets),
    contentType: 'application/json',
  });
});
