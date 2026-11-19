import { expect, type Page, test } from '@playwright/test';

const LINES = [
  'Hey team, the notes are ready',
  'Please check the rollout plan',
];

async function openComposer(page: Page) {
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
  await editor.click();
  await page.keyboard.type(LINES[0]);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type(LINES[1]);
  return editor;
}

const lines = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-markdown-editable] > p'),
      (paragraph) => paragraph.textContent ?? ''
    )
  );

/** A point inside character `offset` of line `line`, so the caret lands before it. */
function pointBefore(page: Page, line: number, offset: number) {
  return page.evaluate(
    ({ line, offset }) => {
      const text = document
        .querySelectorAll('[data-markdown-editable] > p')
        [line]?.querySelector('span')?.firstChild;
      if (!text) throw new Error('draft text missing');
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 4, y: rect.top + rect.height / 2 };
    },
    { line, offset }
  );
}

/**
 * Sends the press and the release without waiting for the page to handle the
 * press, as a trackpad tap-to-click arrives. The click then reaches the page
 * before the selectionchange the press caused, which is also what a busy main
 * thread does to an ordinary click.
 */
async function tap(page: Page, line: number, offset: number) {
  const point = await pointBefore(page, line, offset);
  const cdp = await page.context().newCDPSession(page);
  const event = {
    x: point.x,
    y: point.y,
    button: 'left' as const,
    clickCount: 1,
  };
  await page.mouse.move(point.x, point.y);
  await Promise.all([
    cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...event }),
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...event }),
  ]);
  await cdp.detach();
  await page.waitForTimeout(100);
}

// The click used to write Lexical's previous selection back over the caret the
// browser had just placed, so the caret stayed where it was and typing landed
// at the end of the draft.
test('a quick click moves the caret within a typed draft', async ({ page }) => {
  const editor = await openComposer(page);
  await tap(page, 0, 4);
  await page.keyboard.type('A');
  await tap(page, 1, 17);
  await page.keyboard.type('B');
  await tap(page, 0, 0);
  await page.keyboard.type('C');
  await expect(editor).toBeFocused();
  expect(await lines(page)).toEqual([
    'CHey Ateam, the notes are ready',
    'Please check the Brollout plan',
  ]);
});

test('a quick click moves the caret within a restored draft', async ({
  page,
}) => {
  await openComposer(page);
  await page.getByRole('button', { name: 'Leave channel' }).click();
  await page.getByRole('button', { name: 'Open channel' }).click();
  await expect.poll(() => lines(page)).toEqual(LINES);
  await page.locator('[data-markdown-editable]').click();
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await tap(page, 1, 7);
  await page.keyboard.type('A');
  await tap(page, 0, 15);
  await page.keyboard.type('B');
  expect(await lines(page)).toEqual([
    'Hey team, the nBotes are ready',
    'Please Acheck the rollout plan',
  ]);
});

test('a click beside the draft text still focuses the composer', async ({
  page,
}) => {
  const editor = await openComposer(page);
  await page.getByRole('heading', { name: 'Channel composer draft' }).click();
  await expect(editor).not.toBeFocused();
  // Just below the text, outside the editable root.
  const box = await editor.boundingBox();
  if (!box) throw new Error('editor not laid out');
  await page.mouse.click(box.x + box.width - 4, box.y + box.height + 2);
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  expect(await lines(page)).toEqual([LINES[0], `${LINES[1]}!`]);
});
