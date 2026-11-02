import { expect, test } from '@playwright/test';

// Use the complete dev entry and Solid refresh transforms. Component fixtures
// and production bundles cannot expose initialization cycles in this graph.
test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Missing app URL');
  const origin = new URL(baseURL).origin;
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== origin ||
      (['fetch', 'xhr'].includes(request.resourceType()) &&
        !url.pathname.endsWith('.wasm'))
    ) {
      return route.abort();
    }
    return route.continue();
  });
});

test('the anonymous app boots and reloads without a page error', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app', { waitUntil: 'load' });
  expect(errors).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Continue with email' })
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.reload({ waitUntil: 'load' });
  await expect(
    page.getByRole('button', { name: 'Continue with email' })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('warming Drive leaves editor runtime with detail activation', async ({
  page,
}) => {
  const runtimeRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // Vite's URL-only module is asset metadata, not runtime/byte admission.
    if (url.searchParams.has('url')) return;
    const path = url.pathname;
    if (path.includes('loro-crdt') || /loro.*\.wasm/.test(path))
      runtimeRequests.push(path);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app', { waitUntil: 'load' });
  await expect(
    page.getByRole('button', { name: 'Continue with email' })
  ).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/routes/lazy-route-views.ts',
      location.origin
    ).href;
    const { DriveRouteView } = await import(/* @vite-ignore */ moduleUrl);
    await DriveRouteView.preload();
  });
  expect(runtimeRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('markdown code preparation loads WASM without mounting an editor', async ({
  page,
}) => {
  const errors: string[] = [];
  const wasm: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.headers()['content-type']?.includes('application/wasm'))
      wasm.push(response.url());
  });
  await page.goto('/app', { waitUntil: 'load' });
  await expect(
    page.getByRole('button', { name: 'Continue with email' })
  ).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/features/block-md/definition.ts',
      location.origin
    ).href;
    const { definition } = await import(/* @vite-ignore */ moduleUrl);
    await definition.component.preload();
  });
  expect(wasm).toHaveLength(1);
  await expect(
    page.getByRole('button', { name: 'Continue with email' })
  ).toBeVisible();
  await expect(page.locator('[aria-label="Document content"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
