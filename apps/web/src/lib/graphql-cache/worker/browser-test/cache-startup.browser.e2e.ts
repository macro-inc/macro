import { expect, test } from '@playwright/test';

for (const failure of ['slow-download', 'failed-download'] as const) {
  test(`cache startup preserves existing data through ${failure}`, async ({
    context,
    page,
  }, testInfo) => {
    const path = testInfo.project.name.includes('production')
      ? '/app/cache-lifecycle.html'
      : '/cache-lifecycle.html';
    const scope = `cache-startup-${crypto.randomUUID()}`;
    const url = `${path}?treatment=true&scope=${scope}`;
    await page.goto(url);
    await expect(page.locator('#result')).toHaveAttribute(
      'data-status',
      'ready'
    );
    await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
    await page.evaluate(() =>
      window.cacheLifecycleHarness.write('startup-preserved')
    );
    await page.goto('about:blank');

    let downloads = 0;
    await context.route(
      /\/cache_wasm_bg[^/]*\.wasm(?:\?.*)?$/,
      async (route) => {
        downloads += 1;
        if (downloads === 1) {
          if (failure === 'failed-download') {
            await route.fulfill({
              status: 503,
              body: 'Transient asset failure',
            });
            return;
          }
          // Longer than both former deadlines: 10s host init and 20s activation.
          await new Promise((resolve) => setTimeout(resolve, 25_000));
        }
        await route.continue();
      }
    );
    await page.goto(url);
    await expect(page.locator('#result')).toHaveAttribute(
      'data-status',
      'ready'
    );
    await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
    expect(downloads).toBe(failure === 'slow-download' ? 1 : 2);
    expect(
      await page.evaluate(() =>
        window.cacheLifecycleHarness.engineWorkerCount()
      )
    ).toBe(failure === 'slow-download' ? 1 : 2);
    expect(
      await page.evaluate(() => window.cacheLifecycleHarness.read())
    ).toMatchObject({
      kind: 'hit',
      data: { user: { soup: { items: [{ id: 'startup-preserved' }] } } },
    });
  });
}

test('a fresh host recovers exhausted downloads on the same page and preserves stored data', async ({
  context,
  page,
}, testInfo) => {
  const path = testInfo.project.name.includes('production')
    ? '/app/cache-lifecycle.html'
    : '/cache-lifecycle.html';
  const url = `${path}?treatment=true&scope=cache-retry-${crypto.randomUUID()}`;
  await page.goto(url);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  await page.evaluate(() =>
    window.cacheLifecycleHarness.write('preserved-after-exhaustion')
  );
  await page.goto('about:blank');
  let downloads = 0;
  const pattern = /\/cache_wasm_bg[^/]*\.wasm(?:\?.*)?$/;
  await context.route(pattern, async (route) => {
    downloads += 1;
    await route.abort('failed');
  });
  await page.goto(url);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  const failed = await page.evaluate(async () => {
    try {
      await window.cacheLifecycleHarness.startSingle();
      return false;
    } catch {
      return true;
    }
  });
  expect(failed).toBe(true);
  expect(downloads).toBe(6);
  await context.unroute(pattern);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  expect(
    await page.evaluate(() => window.cacheLifecycleHarness.read())
  ).toMatchObject({
    kind: 'hit',
    data: { user: { soup: { items: [{ id: 'preserved-after-exhaustion' }] } } },
  });
});
