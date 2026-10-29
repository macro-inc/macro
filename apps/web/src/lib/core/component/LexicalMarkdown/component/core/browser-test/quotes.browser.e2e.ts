import { expect, test } from '@playwright/test';

test('quoting a backward selection includes the first paragraph', async ({
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
      await route.fulfill({ status: 401, body: '{}' });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/quotes.html'
  );
  const editor = page.getByRole('textbox', { name: 'Message' });
  await expect(editor.locator('p')).toHaveCount(3);
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Shift+Home');
  if (testInfo.project.name === 'mobile') {
    // Phones use the composer's format ribbon instead of the floating menu.
    await page.getByRole('button', { name: 'Blockquote', exact: true }).tap();
  } else {
    await page.getByRole('button', { name: 'Body', exact: true }).click();
    await page
      .getByRole('menuitemradio', { name: 'Quote', exact: true })
      .click();
  }

  await expect(editor.locator('blockquote')).toHaveCount(3);
  await expect(editor.locator('blockquote').first()).toHaveText(
    'First paragraph with enough words to wrap onto several lines.'
  );
  const quotes = await editor.locator('blockquote').evaluateAll((elements) =>
    elements.map((element) => ({
      border: getComputedStyle(element).borderLeftWidth,
      fontStyle: getComputedStyle(element).fontStyle,
    }))
  );
  expect(quotes).toEqual([
    { border: '2px', fontStyle: 'italic' },
    { border: '2px', fontStyle: 'italic' },
    { border: '2px', fontStyle: 'italic' },
  ]);
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(page.getByTestId('saved').locator('blockquote')).toHaveCount(3);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('quotes.png'),
    fullPage: true,
  });
});
