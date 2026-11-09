import { expect, type Page, test } from '@playwright/test';

// Every isolated fixture file shares native input setup and diagnostic capture.
export function installBrowserHooks() {
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
    await page.goto('/');
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
