import { expect, test } from '@playwright/test';

test('day hints follow the hovered date and close on gaps, exit and teardown', async ({
  page,
}) => {
  await page.goto('/');
  const first = page.locator('[data-activity-date="2024-01-02"]');
  const last = page.locator('[data-activity-date="2024-12-31"]');
  const tooltip = page.getByRole('tooltip');
  await first.hover();
  await expect(tooltip).toHaveText('1 action on Tue, Jan 2, 2024');
  await last.hover();
  await expect(tooltip).toHaveText('9 actions on Tue, Dec 31, 2024');
  await expect(async () => {
    const cell = await last.boundingBox();
    const hint = await tooltip.boundingBox();
    expect(cell).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(
      Math.abs(hint!.x + hint!.width / 2 - cell!.x - cell!.width / 2)
    ).toBeLessThan(20);
  }).toPass();
  const cell = await last.boundingBox();
  await page.mouse.move(cell!.x - 1, cell!.y + cell!.height / 2);
  await expect(tooltip).toBeHidden();
  await last.hover();
  await expect(tooltip).toHaveText('9 actions on Tue, Dec 31, 2024');
  await page
    .getByRole('button', { name: 'Update counts' })
    .dispatchEvent('click');
  await expect(tooltip).toHaveText('11 actions on Tue, Dec 31, 2024');
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await last.hover();
  await expect(tooltip).toBeVisible();
  await page.getByRole('button', { name: 'Toggle graph' }).click();
  await expect(tooltip).toBeHidden();
});

test('loading cells have no day hint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle skeleton' }).click();
  await page.locator('[data-activity-day]').last().hover();
  await expect(page.getByRole('tooltip')).toBeHidden();
});

test('touch keeps the graph scrollable without a hover hint', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await page.locator('[data-activity-date="2024-12-31"]').tap();
    await expect(page.getByRole('tooltip')).toBeHidden();
    const area = page.locator('[data-activity-heatmap-weeks]');
    expect(
      await area.evaluate(
        (element) => element.scrollWidth > element.clientWidth
      )
    ).toBe(true);
    const before = await area.evaluate((element) => element.scrollLeft);
    const box = await area.boundingBox();
    if (!box) throw new Error('Heatmap has no layout box');
    const cdp = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + 40, y }],
    });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: box.x + 40 + step * 15, y }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => area.evaluate((element) => element.scrollLeft))
      .toBeLessThan(before);
    await expect(page.getByRole('tooltip')).toBeHidden();
  } finally {
    await context.close();
  }
});
