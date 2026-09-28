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
