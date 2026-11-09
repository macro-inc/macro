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
});

test('a failed native load preserves the shell and reaches the error boundary', async ({
  page,
}) => {
  await page.route('**/document_session_wasm_bg.wasm', (route) =>
    route.abort()
  );
  await page.goto(fixture);
  await expect(page.getByText('Editor engine failed')).toBeVisible();
  await expect(page.getByText('Application shell ready')).toBeVisible();
  await expect(page.getByText('Editor subtree ready')).toHaveCount(0);
});
