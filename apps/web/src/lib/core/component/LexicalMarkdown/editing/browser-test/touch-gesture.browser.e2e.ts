import { expect, test } from '@playwright/test';

test('installed touch gesture admits real single-cell then expanded table selection', async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== 'chromium' || !info.project.use.hasTouch,
    'Trusted touch protocol is Chromium touch profile only'
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page
    .getByRole('button', { name: 'Load touch table', exact: true })
    .tap();
  const cells = page.locator('#body td');
  await expect(cells).toHaveCount(9);
  await cells.first().scrollIntoViewIfNeeded();
  await cells.first().tap();
  const point = async (index: number) =>
    cells.nth(index).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - (visualViewport?.offsetLeft ?? 0),
        y: rect.top + rect.height / 2 - (visualViewport?.offsetTop ?? 0),
        id: 1,
      };
    });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [await point(0)],
    });
    await expect(page.locator('#selection')).toContainText('"kind":"table"');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [await point(1)],
    });
    await expect(cells.nth(1)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await cdp.detach();
  }
});
