import { expect, type Page, test } from '@playwright/test';
import { openFixture } from './open-fixture';

test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?multiline'
  );
});

function storedNotes(page: Page) {
  return page.evaluate(() => {
    const stored = document.querySelector('[aria-label="Stored records"]');
    const rows = JSON.parse(stored?.textContent ?? '[]') as {
      rowId: string;
      cells: { notes?: string };
    }[];
    return Object.fromEntries(rows.map((row) => [row.rowId, row.cells.notes]));
  });
}

/** The characters before the caret in the focused cell editor. */
function caretOffset(page: Page) {
  return page.evaluate(() => {
    const editor = document.activeElement;
    const selection = getSelection();
    if (!editor || !selection?.rangeCount) return -1;
    const before = document.createRange();
    before.selectNodeContents(editor);
    const caret = selection.getRangeAt(0);
    before.setEnd(caret.startContainer, caret.startOffset);
    return before.toString().length;
  });
}

test('a multi-line note shows every line and takes new lines without leaving its row', async ({
  page,
}) => {
  const cell = page.getByRole('button', { name: /^Notes: Line one/ });
  await expect(cell).toHaveText('Line one Line two Line three');
  await cell.click();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line four');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('Line five');
  // A line started and taken back leaves no line break behind.
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  // Shift+Enter used to save and open the record above, so the next line
  // typed replaced that record's note.
  await expect(editor).toHaveCount(1);
  await expect(editor).toContainText('Line one');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => storedNotes(page))
    .toMatchObject({
      one: 'Follow up',
      lines: 'Line one\nLine two\nLine three\nLine four\nLine five',
    });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /^Notes: Line one/ })
  ).toHaveText('Line one Line two Line three Line four Line five');
});

test('arrow keys move through a wrapped note before leaving it', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Notes: Long note/ }).click();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await expect(editor).toBeFocused();
  expect((await editor.boundingBox())?.height).toBeGreaterThan(60);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await expect(editor).toContainText('Long note');
  await expect(editor).toBeFocused();
  expect(await caretOffset(page)).toBeGreaterThan(0);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await expect(editor).toContainText('Line three');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  expect((await storedNotes(page)).wrapped).toMatch(/^Long note: /);
});

test('a text cell keeps its weight and line height when it opens', async ({
  page,
}) => {
  const cell = page.getByRole('button', { name: /^Notes: Long note/ });
  const typography = (element: Element) => {
    const style = getComputedStyle(element);
    return { weight: style.fontWeight, lineHeight: style.lineHeight };
  };
  const closed = await cell.evaluate(typography);
  await cell.click();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await expect(editor).toBeFocused();
  expect(await editor.evaluate(typography)).toEqual(closed);
});
