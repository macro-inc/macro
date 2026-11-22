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

/** Leaves the composer as dismissing the phone keyboard does. */
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

test('a tap on a long mention in the phone composer pill opens the composer', async ({
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
  await expect(preview.getByText(documentName)).toBeVisible();

  // Measured in one pass: the preview rerenders as the mention's name lands
  // in the draft.
  const layout = await preview.evaluate((element) => {
    const textNode = element.querySelector('p')?.firstChild;
    const mention = element.querySelector('[data-document-mention]');
    if (!textNode || !mention) throw new Error('Draft not laid out');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const box = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      height: rect.height,
    });
    return {
      preview: box(element.getBoundingClientRect()),
      mention: box(mention.getBoundingClientRect()),
      text: box(range.getBoundingClientRect()),
    };
  });
  // The mention runs past the end of the preview, so the chip is under
  // every tap on the line after the text before it.
  expect(layout.mention.right).toBeGreaterThan(layout.preview.right);

  const middle = layout.preview.top + layout.preview.height / 2;
  const points: [string, number, number][] = [
    ['the start of the mention', layout.mention.left + 10, middle],
    ['the end of the line', layout.preview.right - 20, middle],
    ['the text before the mention', layout.text.left + 4, middle],
  ];
  for (const [where, x, y] of points) {
    await page.touchscreen.tap(x, y);
    await expect(pill, `tap on ${where}`).toBeHidden();
    await expect
      .poll(() => editorHasCaret(page), `caret after a tap on ${where}`)
      .toBe(true);
    await dismissKeyboard(page);
    await expect(pill).toBeVisible();
  }
  await page.screenshot({
    path: test.info().outputPath('long-mention-phone.png'),
  });
  await context.close();
});
