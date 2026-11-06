import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`clears a pending send and restores a failed draft on ${mobile ? 'phone' : 'desktop'}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.hostname === 'localhost' &&
        !url.pathname.startsWith('/__macro_dev/')
      )
        await route.continue();
      else
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: '{"responses":[]}',
        });
    });
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.goto('/src/features/channel/Input/browser-test/draft.html');
    const editor = page.locator('[data-markdown-editable]');
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.fill('pending message');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(page.getByLabel('Sent message')).toHaveText('pending message');
    await expect(editor).toHaveText('');
    await page.getByRole('button', { name: 'Fail send' }).click();
    await expect(editor).toHaveText('pending message');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(editor).toHaveText('');
    await editor.fill('next draft');
    await page.getByRole('button', { name: 'Fail send' }).click();
    await expect(editor).toHaveText('next draft');
    await context.close();
  });
}
