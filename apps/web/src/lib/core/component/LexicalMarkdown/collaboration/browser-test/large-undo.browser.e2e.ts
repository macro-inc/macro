import { expect, type Page, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/collaboration/browser-test/large-undo.html';

// About the length of Moby-Dick (1.2 MB of text).
const PARAGRAPHS = 4000;
// Undo used to reconcile the editor and look up the caret's Loro container in
// time quadratic in the document; at this size the document did not finish
// opening in two minutes. Now undoing typing takes about 300 ms, and restoring
// a thousand paragraphs about 900 ms, 400 ms of it in Loro's own undo.
const UNDO_TYPING_BUDGET_MS = 600;
const UNDO_DELETION_BUDGET_MS = 1500;

async function openLargeDocument(page: Page) {
  await page.goto(`${fixture}?paragraphs=${PARAGRAPHS}`);
  await page.waitForFunction(() => window.largeUndo?.ready(), undefined, {
    timeout: 120_000,
  });
  expect(await page.evaluate(() => window.largeUndo!.paragraphs())).toBe(
    PARAGRAPHS
  );
  return page.evaluate(() => window.largeUndo!.text());
}

async function timeUndo(page: Page, expected: string) {
  await page.evaluate((text) => window.largeUndo!.armUndoTimer(text), expected);
  await page.keyboard.press('ControlOrMeta+z');
  return page.evaluate(() => window.largeUndo!.undoTime());
}

test('undoing typing in a large document stays within the budget', async ({
  page,
}) => {
  const original = await openLargeDocument(page);

  await page.evaluate(() => window.largeUndo!.placeAtEnd(2000));
  await page.keyboard.type(' undo me');
  await expect
    .poll(() => page.evaluate(() => window.largeUndo!.text()))
    .toContain(' undo me');

  const ms = await timeUndo(page, original);
  console.log(`undo of typing took ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(UNDO_TYPING_BUDGET_MS);
});

test('undoing the deletion of a thousand paragraphs stays within the budget', async ({
  page,
}) => {
  const original = await openLargeDocument(page);

  await page.evaluate(() => window.largeUndo!.selectBlocks(1000, 1999));
  await page.keyboard.press('Backspace');
  await expect
    .poll(() => page.evaluate(() => window.largeUndo!.paragraphs()))
    .toBe(PARAGRAPHS - 999);

  const ms = await timeUndo(page, original);
  console.log(`undo of deletion took ${ms.toFixed(0)} ms`);
  expect(await page.evaluate(() => window.largeUndo!.paragraphs())).toBe(
    PARAGRAPHS
  );
  expect(ms).toBeLessThan(UNDO_DELETION_BUDGET_MS);
});
