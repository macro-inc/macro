import { expect, test } from '@playwright/test';

test('coalesces revision-only changes and keeps every mounted row', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/churn.html');
  await expect(page.locator('li')).toHaveCount(1000);
  await page.clock.install();
  const initial = await page.evaluate(() => window.soupChurn.stats());
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.soupChurn.stats())).toEqual(initial);
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => window.soupChurn.emit());
    await page.clock.runFor(10);
  }
  await page.clock.runFor(250);
  const final = await page.evaluate(() => window.soupChurn.stats());
  expect(final.revision).toBe(101);
  expect(final.reads - initial.reads).toBeLessThanOrEqual(9);
  expect(final.mounts).toBe(initial.mounts);
  await expect(page.locator('li')).toHaveCount(1000);
});
