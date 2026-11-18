import { expect, test } from '@playwright/test';

const fixture = '/src/lib/core/document-session/browser-test/index.html';

test('shell paints while native loading holds only the editor subtree', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/document_session_wasm_bg.wasm', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto(fixture);
    await expect(page.getByText('Application shell ready')).toBeVisible();
    await expect(page.getByText('Loading editor engine')).toBeVisible();
    await expect(page.getByText('Editor subtree ready')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await expect(page.getByText('Application shell ready')).toBeVisible();
  const marks = await page.evaluate(() => ({
    start: performance
      .getEntriesByName('macro.editor.engine.preload-start')
      .map((entry) => entry.startTime),
    ready: performance
      .getEntriesByName('macro.editor.engine.ready')
      .map((entry) => entry.startTime),
  }));
  expect(marks.start).toHaveLength(1);
  expect(marks.ready).toHaveLength(1);
  expect(marks.ready[0]).toBeGreaterThanOrEqual(marks.start[0]);
});

test('flag off constructs the existing subtree without requesting native WASM', async ({
  page,
}) => {
  const binaries: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('document_session_wasm'))
      binaries.push(request.url());
  });
  await page.goto(`${fixture}?native=false`);
  await expect(page.getByText('Application shell ready')).toBeVisible();
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  expect(binaries).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        performance.getEntriesByName('macro.editor.engine.preload-start').length
    )
  ).toBe(0);
  expect(
    await page.evaluate(
      () => performance.getEntriesByName('macro.editor.engine.ready').length
    )
  ).toBe(1);
});

test('a document factory receives the real durable session synchronously after preload', async ({
  page,
}) => {
  const failures: string[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto(fixture);
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await page.getByRole('button', { name: 'Attach durable session' }).click();
  await expect(page.getByText('Durable attachment closed')).toBeVisible();
  const host = new URL(page.url()).host;
  expect(sockets.filter((url) => new URL(url).host !== host)).toEqual([]);
  expect(failures).toEqual([]);
});

test('a failed native load preserves the shell and retries the shared engine', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.route('**/document_session_wasm_bg.wasm', (route) =>
    route.abort()
  );
  await page.goto(fixture);
  await expect(page.getByText('Editor engine failed')).toBeVisible();
  await expect(page.getByText('Application shell ready')).toBeVisible();
  await expect(page.getByText('Editor subtree ready')).toHaveCount(0);
  await page.unroute('**/document_session_wasm_bg.wasm');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await expect(page.getByText('Application shell ready')).toBeVisible();
  expect(failures).toEqual([]);
});

test('session-only attachment defers start until registration without a mounted view', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(fixture);
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await page
    .getByRole('button', { name: 'Attach session without DOM' })
    .click();
  await expect(page.getByText('Session-only attachment closed')).toBeVisible();
  expect(failures).toEqual([]);
});

test('synchronous authorization revocation waits for registration and is retained', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(fixture);
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await page.getByRole('button', { name: 'Attach revoked session' }).click();
  await expect(page.getByText('Revoked attachment closed')).toBeVisible();
  expect(failures).toEqual([]);
});

test('factory cancellation closes the real session before Start', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(fixture);
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await page.getByRole('button', { name: 'Close unstarted session' }).click();
  await expect(page.getByText('Unstarted attachment closed')).toBeVisible();
  expect(failures).toEqual([]);
});

test('terminal output can reenter close without creating another close operation', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(fixture);
  await expect(page.getByText('Editor subtree ready')).toBeVisible();
  await page.getByRole('button', { name: 'Close session reentrantly' }).click();
  await expect(page.getByText('Reentrant attachment closed')).toBeVisible();
  expect(failures).toEqual([]);
});
