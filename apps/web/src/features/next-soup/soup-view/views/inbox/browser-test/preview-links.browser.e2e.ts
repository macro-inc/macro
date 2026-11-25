import { expect, type Page, test } from '@playwright/test';

const PAGE =
  '/src/features/next-soup/soup-view/views/inbox/browser-test/signal-swipe-done.html?links';

declare global {
  interface Window {
    __signalOpened: string[];
    /** Every URL the page tried to open in a window. */
    __windowOpens: string[];
  }
}

/** Block every request off this machine; the fixture's list is in memory. */
async function stayLocal(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (!loopback && !['data:', 'blob:'].includes(url.protocol)) ||
      url.pathname.startsWith('/__macro_dev/')
    ) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('tapping a link in a comment opens the row, not the link', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__windowOpens = [];
    window.open = (url) => {
      window.__windowOpens.push(String(url));
      return null;
    };
  });
  await stayLocal(page);
  await page.goto(PAGE);
  const link = page
    .locator('[data-swipe-row][data-swipe-id="row|doc-spec"]')
    .locator('a[href="https://example.test/spec"]');
  // The first load pre-bundles the app's dependencies.
  await expect(link).toBeVisible({ timeout: 180_000 });
  const box = await link.boundingBox();
  if (!box) throw new Error('link not laid out');

  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

  await expect
    .poll(() => page.evaluate(() => window.__signalOpened))
    .toEqual(['doc-spec']);
  expect(await page.evaluate(() => window.__windowOpens)).toEqual([]);
});
