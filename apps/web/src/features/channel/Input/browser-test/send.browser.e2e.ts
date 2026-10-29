import { expect, test } from '@playwright/test';

for (const { mobile, privateThread } of [
  { mobile: false, privateThread: false },
  { mobile: true, privateThread: false },
  { mobile: false, privateThread: true },
  { mobile: true, privateThread: true },
]) {
  test(`clears a pending ${privateThread ? 'private' : 'shared'} send and restores a failed draft on ${mobile ? 'phone' : 'desktop'}`, async ({
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
    const visibility = page.getByRole('button', {
      name: 'Message visibility',
      exact: true,
    });
    if (privateThread) {
      await visibility.click();
      await page.getByRole('menuitemradio', { name: /Only you/ }).click();
    }
    await editor.fill('pending message');
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(page.getByLabel('Sent message')).toHaveText('pending message');
    await expect(editor).toHaveText('');
    await expect(page.getByLabel('Sent visibility')).toHaveText(
      privateThread ? 'Only you' : 'Everyone'
    );
    await page.getByRole('button', { name: 'Fail send' }).click();
    await expect(editor).toHaveText('pending message');
    await expect(visibility).toContainText(
      privateThread ? 'Only you' : 'Everyone'
    );
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(editor).toHaveText('');
    await editor.fill('next draft');
    await page.getByRole('button', { name: 'Fail send' }).click();
    await expect(editor).toHaveText('next draft');
    await expect(visibility).toContainText('Everyone');
    await context.close();
  });
}

test('custom composer actions read context after the input provider mounts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
  await page.goto(
    '/src/features/channel/Input/browser-test/draft.html?customActions'
  );
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true })
  ).toHaveCount(2, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('phone privacy choices and menu dismissal keep the composer expanded', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/features/channel/Input/browser-test/draft.html?collapsible'
  );
  await page.locator('[data-collapsed-input-preview]').click();
  const editor = page.locator('[data-markdown-editable]');
  const visibility = page.getByRole('button', { name: 'Message visibility' });
  await visibility.click();
  await page.getByRole('menuitemradio', { name: /^Only you/ }).click();
  await expect(visibility).toBeVisible();
  await expect(visibility).toContainText('Only you');
  await editor.fill('private phone draft');
  await visibility.click();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(visibility).toContainText('Only you');
  await visibility.click();
  await page.getByRole('menuitemradio', { name: /^Everyone/ }).click();
  await expect(editor).toBeVisible();
  await expect(visibility).toContainText('Everyone');
  await page.getByRole('button', { name: 'Send message', exact: true }).tap();
  await expect(page.getByLabel('Sent visibility')).toHaveText('Everyone');
  await context.close();
});
