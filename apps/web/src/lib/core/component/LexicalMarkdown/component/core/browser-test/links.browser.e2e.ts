import { expect, test } from '@playwright/test';

test('agent URLs navigate and removed links survive save and reopen', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.includes('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status:
          url.pathname.includes('unfurl') || url.hostname === 'apps.apple.com'
            ? 200
            : 401,
        contentType: 'application/json',
        body: JSON.stringify({ responses: [] }),
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/links.html'
  );
  const url = 'https://apps.apple.com/us/app/macro-app/id6743133649';
  const link = page
    .getByTestId('original')
    .getByRole('link', { name: url, exact: true });
  await expect(link).toHaveAttribute('href', url, { timeout: 30_000 });
  await expect(page.getByTestId('explicit').getByRole('link')).toHaveAttribute(
    'href',
    url
  );
  const cases = page.getByTestId('cases');
  await expect(cases.getByRole('link')).toHaveCount(2);
  await expect(cases.getByRole('link').first()).toHaveAttribute(
    'href',
    'https://example.com/a%20b?q=x%2Fy#part'
  );
  await expect(cases.getByRole('link').last()).toHaveAttribute(
    'href',
    'https://example.com/a~~b~~c'
  );
  await expect(cases).toContainText('https://example.com/removed');
  const popupPromise = page.waitForEvent('popup');
  if (testInfo.project.use.hasTouch) await link.tap();
  else {
    await link.focus();
    await page.keyboard.press('Enter');
  }
  const popup = await popupPromise;
  await expect(popup).toHaveURL(url);
  await popup.close();

  const editor = page.getByRole('textbox', { name: 'Message' });
  await editor.locator('a').click();
  await page.getByRole('button', { name: 'Remove link' }).click();
  await expect(editor.locator('a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save message', exact: true }).click();
  await expect(page.getByTestId('saved')).toHaveText(url);
  await expect(page.getByTestId('saved').locator('a')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen saved message' }).click();
  await expect(editor).toHaveText(url);
  await expect(editor.locator('a')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.locator('main').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath('links.png'),
    fullPage: true,
  });
});
