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

test('routed keyboard typing undo and both redo shortcuts restore content and caret', async ({
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
  await page.evaluate(() => window.historyRun.clearHistory());
  const before = await page.evaluate(() => window.historyRun.snapshot());
  await page.keyboard.type('code');
  const committed = await page.evaluate(() => window.historyRun.snapshot());
  expect(committed.content).toContain('code');
  expect(committed.anchor.offset).toBe(4);
  for (const shortcut of ['Control+Shift+z', 'Control+y']) {
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.historyRun.snapshot())).toEqual(
      before
    );
    await page.keyboard.press(shortcut);
    expect(await page.evaluate(() => window.historyRun.snapshot())).toEqual(
      committed
    );
  }
  await page.evaluate(() => window.historyRun.close());
  expect(errors).toEqual([]);
});

test('code subtree redo retains exact raw model identities and caret', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/src/session/browser-test/index.html');
  await page.evaluate(async () => {
    window.historyRun = await window.historyFixture(true);
  });
  await page.locator('#history-keyboard').focus();
  await page.keyboard.type('x');
  const typed = await page.evaluate(() => window.historyRun.snapshot());
  expect(typed.content).toContain('const localValue = 1;x');
  expect(typed.anchor.offset).toBe(22);
  for (const redo of ['Control+Shift+z', 'Control+y']) {
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => window.historyRun.snapshot());
    const children = JSON.parse(undone.content).root.children;
    expect(children.map((node: { type: string }) => node.type)).toEqual([
      'paragraph',
    ]);
    await page.keyboard.press(redo);
    expect(await page.evaluate(() => window.historyRun.snapshot())).toEqual(
      typed
    );
  }
  await page.evaluate(() => window.historyRun.close());
  expect(errors).toEqual([]);
});
