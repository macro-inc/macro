import { expect, type Page, test } from '@playwright/test';

const documentId = '0195ceb6-ec2e-7023-80e4-6e084fa6cccd';
const documentUrl = `https://dev.macro.com/app/md/${documentId}`;
const documentName =
  'Quarterly planning notes for the customer onboarding and retention review';

async function openFixture(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    )
      await route.continue();
    // The mention's name, from the preview read that follows the refused
    // GraphQL one.
    else if (url.pathname.endsWith('/dss/documents/preview'))
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          previews: [
            {
              type: 'access',
              document_id: documentId,
              document_name: documentName,
              file_type: 'md',
              owner: 'fixture-user',
            },
          ],
        }),
      });
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/features/channel/Input/browser-test/draft.html?collapsible'
  );
}

/** Types a few words, then pastes a link that becomes a long mention. */
async function writeLongMention(page: Page) {
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Notes ');
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, documentUrl);
  await expect(editor.getByText(documentName)).toBeVisible();
}

/**
 * Leaves the composer as dismissing the phone keyboard does. A tap outside
 * blurs it in Chromium but not in WebKit.
 */
const dismissKeyboard = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

/** Whether the editor has focus and the caret is inside it. */
const editorHasCaret = (page: Page) =>
  page.evaluate(() => {
    const editor = document.querySelector('[data-markdown-editable]');
    const anchor = window.getSelection()?.anchorNode;
    return (
      !!editor &&
      editor.contains(document.activeElement) &&
      !!anchor &&
      editor.contains(anchor)
    );
  });

test('a tap anywhere on the phone composer pill opens it over a long mention', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await openFixture(page);
  const pill = page.locator('[data-composer-collapsed]');
  const preview = page.locator('[data-collapsed-input-preview]');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await preview.tap();
  await writeLongMention(page);

  await dismissKeyboard(page);
  await expect(pill).toBeVisible();
  const mention = preview.getByText(documentName);
  await expect(mention).toBeVisible();

  // Measured in one pass: the preview rerenders as the mention's name lands
  // in the draft.
  const layout = await pill.evaluate((element) => {
    const rect = (selector: string) => {
      const found = element.querySelector(selector);
      if (!found) throw new Error(`No ${selector}`);
      return found.getBoundingClientRect().toJSON() as DOMRect;
    };
    const textNode = element.querySelector(
      '[data-collapsed-input-preview] p'
    )?.firstChild;
    if (!textNode) throw new Error('No draft text');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return {
      pill: element.getBoundingClientRect().toJSON() as DOMRect,
      add: rect('button[aria-label="Add"]'),
      preview: rect('[data-collapsed-input-preview]'),
      mention: rect('[data-collapsed-input-preview] [data-document-mention]'),
      text: range.getBoundingClientRect().toJSON() as DOMRect,
    };
  });
  // The mention is cut off inside the pill rather than widening it.
  expect(layout.pill.right).toBeLessThanOrEqual(390);
  expect(layout.mention.right).toBeGreaterThan(layout.preview.right);

  const middle = layout.pill.top + layout.pill.height / 2;
  const points: [string, number, number][] = [
    // The chip covers most of the line; its own tap opened nothing.
    ['mention', layout.preview.right - 20, middle],
    ['text before the mention', layout.text.left + 4, middle],
    ['padding beside the add button', layout.add.right + 3, middle],
    ['padding above the draft', layout.preview.left + 40, layout.pill.top + 3],
    [
      'padding below the draft',
      layout.preview.left + 40,
      layout.pill.bottom - 3,
    ],
  ];
  for (const [where, x, y] of points) {
    await page.touchscreen.tap(x, y);
    await expect(pill, `tap on ${where}`).toBeHidden();
    await expect
      .poll(() => editorHasCaret(page), `caret after ${where}`)
      .toBe(true);
    // The open composer keeps the long mention inside the screen.
    const editorRight = await page
      .locator('[data-markdown-editable]')
      .evaluate((element) => element.getBoundingClientRect().right);
    expect(editorRight).toBeLessThanOrEqual(390);
    await dismissKeyboard(page);
    await expect(pill).toBeVisible();
  }
  await page.screenshot({
    path: test.info().outputPath('long-mention-phone.png'),
  });
  await context.close();
});

test('taps beside a long mention focus the tablet composer', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await openFixture(page);
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  // Tablets keep the full composer; there is no pill.
  await expect(page.locator('[data-composer-collapsed]')).toHaveCount(0);
  await editor.tap();
  await writeLongMention(page);

  const layout = await editor.evaluate((element) => {
    const textNode = element.querySelector('p')?.firstChild;
    const mention = element.querySelector('[data-document-mention]');
    if (!textNode || !mention) throw new Error('Draft not laid out');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return {
      editor: element.getBoundingClientRect().toJSON() as DOMRect,
      mention: mention.getBoundingClientRect().toJSON() as DOMRect,
      text: range.getBoundingClientRect().toJSON() as DOMRect,
    };
  });
  const points: [string, number, number][] = [
    [
      'text before the mention',
      layout.text.left + 4,
      layout.text.top + layout.text.height / 2,
    ],
    [
      'space after the mention',
      (layout.mention.right + layout.editor.right) / 2,
      layout.mention.top + layout.mention.height / 2,
    ],
  ];
  for (const [where, x, y] of points) {
    await dismissKeyboard(page);
    await expect(editor).not.toBeFocused();
    await page.touchscreen.tap(x, y);
    await expect
      .poll(() => editorHasCaret(page), `caret after ${where}`)
      .toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath('long-mention-tablet.png'),
  });
  await context.close();
});
