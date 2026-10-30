import { expect, test } from '@playwright/test';

async function openEmptyComposer(page: import('@playwright/test').Page) {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.includes('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({ status: 401, body: '{}' });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/quotes.html?initial='
  );
  const editor = page.getByRole('textbox', { name: 'Message' });
  await expect(editor).toBeVisible({ timeout: 60_000 });
  return editor;
}

test('typing 6. then Enter starts an ordered list at 6', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const editor = await openEmptyComposer(page);
  await editor.click();
  await page.keyboard.type('6.');
  await page.keyboard.press('Enter');

  const list = editor.locator('ol');
  await expect(list).toHaveCount(1);
  await expect(list).toHaveAttribute('start', '6');
  await page.keyboard.type('Reply to item six');
  await expect(list.locator('li').first()).toHaveText('Reply to item six');

  await page.getByRole('button', { name: 'Save message' }).click();
  const saved = page.getByTestId('saved').locator('ol');
  await expect(saved).toHaveAttribute('start', '6');
  await expect(saved).toHaveText('Reply to item six');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('ordered-list-start.png'),
    fullPage: true,
  });
});
