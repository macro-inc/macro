import { expect, test } from '@playwright/test';
import type {} from './fixture';

test('keyboard redo restores the committed caret after recreating a paragraph', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/src/session/browser-test/index.html');
  await page.evaluate(async () => {
    window.historyRun = await window.historyFixture();
  });
  await page.locator('#history-keyboard').focus();
  await page.keyboard.press('Enter');
  const committed = await page.evaluate(() => window.historyRun.snapshot());
  expect(committed.anchor.kind).toBe(1);
  expect(committed.anchor.offset).toBe(0);
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => window.historyRun.snapshot());
  expect(undone.anchor.id).not.toBe(committed.anchor.id);
  await page.keyboard.press('Control+y');
  const redone = await page.evaluate(() => window.historyRun.snapshot());
  expect(redone).toEqual(committed);
  await page.evaluate(() => window.historyRun.close());
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    historyRun: Awaited<ReturnType<typeof window.historyFixture>>;
  }
}
