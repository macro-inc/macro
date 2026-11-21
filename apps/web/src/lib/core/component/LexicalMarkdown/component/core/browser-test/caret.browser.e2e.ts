import { expect, type Page, test } from '@playwright/test';
import { editorLines, quickTap, quickTapBefore } from './quick-tap';

const LINES = [
  'Hey team, the notes are ready',
  'Please check the rollout plan',
];

async function openComposer(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' && !url.pathname.includes('/__macro_dev/'))
      await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/caret.html'
  );
  const editor = page.locator(
    'section[aria-label="Composer"] [contenteditable="true"]'
  );
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type(LINES[0]);
  await page.keyboard.press('Enter');
  await page.keyboard.type(LINES[1]);
  await expect.poll(() => editorLines(editor)).toEqual(LINES);
  return editor;
}

// A click re-focused the editor, which wrote Lexical's previous selection back
// over the caret the browser had just placed, so the caret stayed where it was
// and typing landed at the end of the draft.
test('a quick tap moves the caret in the composer', async ({ page }) => {
  const editor = await openComposer(page);
  await quickTapBefore(editor, 0, 4);
  await page.keyboard.type('A');
  await quickTapBefore(editor, 1, 17);
  await page.keyboard.type('B');
  await quickTapBefore(editor, 0, 0);
  await page.keyboard.type('C');
  await expect(editor).toBeFocused();
  expect(await editorLines(editor)).toEqual([
    'CHey Ateam, the notes are ready',
    'Please check the Brollout plan',
  ]);
});

test('a tap beside the composer text still focuses it', async ({
  page,
  isMobile,
}) => {
  // Phones leave a tap on the composer's padding alone (MarkdownShell).
  test.skip(isMobile, 'MarkdownShell does not focus on phone taps');
  const editor = await openComposer(page);
  await page.getByRole('heading', { name: 'Editor caret' }).click();
  await expect(editor).not.toBeFocused();
  // In the shell's padding, just below the text, outside the editable root.
  const box = await editor.boundingBox();
  if (!box) throw new Error('editor not laid out');
  await quickTap(page, { x: box.x + box.width - 4, y: box.y + box.height + 6 });
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  expect(await editorLines(editor)).toEqual([LINES[0], `${LINES[1]}!`]);
});
