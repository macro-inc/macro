import { expect, test } from '@playwright/test';

for (const format of ['plain', 'html', 'lexical'] as const) {
  for (const replaceSelection of [false, true]) {
    test(`pasting ${format} paragraphs ${replaceSelection ? 'over selected text' : 'into an empty quote'} keeps them quoted`, async ({
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
      await expect(editor).toBeVisible({ timeout: 60_000 });
      await expect(editor.locator('p')).toHaveCount(3);
      await editor.focus();
      await page.keyboard.press('ControlOrMeta+A');
      const copied = await editor.evaluate((element) => {
        const clipboardData = new DataTransfer();
        element.dispatchEvent(
          new ClipboardEvent('copy', {
            clipboardData,
            bubbles: true,
            cancelable: true,
          })
        );
        return clipboardData.getData('application/x-lexical-editor');
      });
      await page.keyboard.press('Backspace');
      await page.keyboard.type('> ');
      await expect(editor.locator('blockquote')).toHaveCount(1);
      if (replaceSelection) {
        await page.keyboard.type('Prefix replace suffix');
        // Seed the exact range through the fixture so native selectionchange
        // timing cannot race the synthetic clipboard event on touch devices.
        await page
          .getByRole('button', { name: 'Select replacement text' })
          .click();
        expect(
          await page.evaluate(() => window.getSelection()?.toString())
        ).toBe('replace');
      }
      await editor.evaluate(
        (element, { format, copied }) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData(
            'text/plain',
            'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
          );
          if (format === 'html') {
            clipboardData.setData(
              'text/html',
              '<p>First <strong>paragraph.</strong></p><p>Second <em>paragraph.</em></p><p>Third paragraph.</p>'
            );
          } else if (format === 'lexical') {
            clipboardData.setData('application/x-lexical-editor', copied);
          }
          element.dispatchEvent(
            new ClipboardEvent('paste', {
              clipboardData,
              bubbles: true,
              cancelable: true,
            })
          );
        },
        { format, copied }
      );
      const expected =
        format === 'lexical'
          ? [
              'First paragraph with enough words to wrap onto several lines.',
              'Second paragraph with additional words.',
              'Third paragraph finishes the message.',
            ]
          : ['First paragraph.', 'Second paragraph.', 'Third paragraph.'];
      if (replaceSelection) {
        expected[0] = `Prefix ${expected[0]}`;
        expected[2] += ' suffix';
      }
      if (format === 'lexical') expect(copied).not.toBe('');
      await expect(editor.locator('blockquote')).toHaveText(expected);
      if (format === 'html') {
        await expect(editor.locator('blockquote strong')).toHaveText(
          'paragraph.'
        );
        await expect(editor.locator('blockquote em')).toHaveText('paragraph.');
      }
      await page.keyboard.type(' Still quoted.');
      expected[2] = replaceSelection
        ? expected[2].replace(' suffix', ' Still quoted. suffix')
        : `${expected[2]} Still quoted.`;
      await expect(editor.locator('blockquote')).toHaveText(expected);
      await page.getByRole('button', { name: 'Save message' }).click();
      await expect(page.getByTestId('saved').locator('blockquote')).toHaveText(
        expected
      );
      expect(errors).toEqual([]);
      if (format === 'plain' && !replaceSelection) {
        await page.screenshot({
          path: testInfo.outputPath('quote-paste.png'),
          fullPage: true,
        });
      }
    });
  }
}

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

for (const { name, markdown, quoteCount } of [
  {
    name: 'adjacent quotes',
    markdown: '> First original.\n\n> Middle original.\n\n> Last original.',
    quoteCount: 2,
  },
  {
    name: 'quotes separated by unquoted text',
    markdown: '> First original.\n\nMiddle original.\n\n> Last original.',
    quoteCount: 1,
  },
  {
    name: 'unquoted paragraphs',
    markdown: 'First original.\n\nMiddle original.\n\nLast original.',
    quoteCount: 0,
  },
]) {
  test(`pasting over ${name} respects the selected blocks`, async ({
    page,
    context,
  }) => {
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
      `/src/lib/core/component/LexicalMarkdown/component/core/browser-test/quotes.html?${new URLSearchParams({ initial: markdown })}`
    );
    const editor = page.getByRole('textbox', { name: 'Message' });
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        'text/plain',
        'First replacement.\n\nSecond replacement.'
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await expect(editor.locator(':scope > blockquote, :scope > p')).toHaveText([
      'First replacement.',
      'Second replacement.',
    ]);
    await expect(editor.locator('blockquote')).toHaveCount(quoteCount);
    await page.getByRole('button', { name: 'Save message' }).click();
    await expect(page.getByTestId('saved').locator('blockquote')).toHaveCount(
      quoteCount
    );
    expect(errors).toEqual([]);
  });
}
