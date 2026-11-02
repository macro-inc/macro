import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('the resting back pane skips layout and is restored for back and forward motion', async ({
  page,
}) => {
  await page.goto('/mobile.html');
  const calendar = page.locator('[data-calendar-pane]');
  const front = page.locator('[data-front-pane]');
  await expect(calendar).toHaveCSS('display', 'none');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.setViewportSize({ width: 430, height: 844 });
  await page.getByRole('button', { name: 'Weekends' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event('calendar-calls'))
  );
  expect(JSON.parse(await page.locator('[data-calls]').innerText())).toEqual(
    []
  );

  // A real touch start reveals the retained calendar before the drag moves.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 5, y: 150 }],
  });
  await expect(calendar).not.toHaveCSS('display', 'none');
  await expect(page.locator('.fc-col-header-cell')).toHaveCount(5);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 220, y: 150 }],
  });
  await expect(front).not.toHaveCSS('display', 'none');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect(calendar).toHaveCSS('display', 'none');

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(front).toHaveCSS('display', 'none');
  await expect(calendar).not.toHaveCSS('display', 'none');
  expect(
    await page
      .locator('.fc-view-harness')
      .evaluate((element) => element.clientHeight)
  ).toBeGreaterThan(500);
  // Check the preparation phase synchronously, before its scheduled frames.
  const preparing = await page.evaluate(() => {
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Cover')
      ?.click();
    return ['[data-calendar-pane]', '[data-front-pane]'].map((selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).display : undefined;
    });
  });
  expect(preparing).not.toContain('none');
  await expect(front).not.toHaveCSS('display', 'none');
  await expect(calendar).toHaveCSS('display', 'none');
});
