import { expect, test } from '@playwright/test';

test('Cache exhausts a persisted server retry budget after reload and advances the queue', async ({
  page,
}, testInfo) => {
  const path = testInfo.project.name.includes('production')
    ? '/app/cache-lifecycle.html'
    : '/cache-lifecycle.html';
  const scope = `cache-retry-budget-${crypto.randomUUID()}`;
  await page.goto(`${path}?treatment=true&scope=${scope}`);
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  const ids = await page.evaluate(() =>
    window.cacheLifecycleHarness.seedRetryBudget()
  );
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
  await page.reload();
  await expect(page.locator('#result')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(() => window.cacheLifecycleHarness.startSingle());
  const result = await page.evaluate(() =>
    window.cacheLifecycleHarness.exhaustRetryBudget()
  );
  expect(result.attempts).toBe(2);
  expect(result.settlements).toMatchObject([
    {
      transactionId: ids[0],
      status: 'permanently-failed',
      errorCode: 'MUTATION_RETRY_EXHAUSTED',
    },
    { transactionId: ids[1], status: 'committed' },
  ]);
  await page.evaluate(() => window.cacheLifecycleHarness.dispose());
});
