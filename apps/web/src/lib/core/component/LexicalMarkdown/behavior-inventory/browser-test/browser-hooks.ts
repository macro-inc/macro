import { expect, type Locator, type Page, test } from '@playwright/test';

// Every isolated fixture file shares native input setup and diagnostic capture.
export function installBrowserHooks(path = '/') {
  const PAGE_ERRORS = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    PAGE_ERRORS.set(page, errors);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket(
      (url) => url.hostname !== '127.0.0.1',
      (socket) => socket.close()
    );
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  });

  test.afterEach(async ({ page }, info) => {
    await info.attach('accessibility', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    });
    await info.attach('pixels', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Save state', exact: true }).click();
    await info.attach('serialized-and-markdown', {
      body: await page.locator('#saved').innerText(),
      contentType: 'application/json',
    });
    expect(PAGE_ERRORS.get(page)).toEqual([]);
  });
}

export async function toggleChecklistMarker(
  page: Page,
  check: Locator,
  hasTouch: boolean
) {
  await check.scrollIntoViewIfNeeded();
  const point = await check.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const marker = getComputedStyle(element, '::before');
    return {
      clientX:
        bounds.left + parseFloat(marker.left) + parseFloat(marker.width) / 2,
      clientY:
        bounds.top + parseFloat(marker.top) + parseFloat(marker.height) / 2,
    };
  });
  expect(
    await check.evaluate(
      (element, point) =>
        document.elementFromPoint(point.clientX, point.clientY) === element,
      point
    )
  ).toBe(true);
  // Native input uses the visual viewport; DOM rects use the layout viewport.
  const viewport = await page.evaluate(() => ({
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
  }));
  const x = point.clientX - viewport.left;
  const y = point.clientY - viewport.top;
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
