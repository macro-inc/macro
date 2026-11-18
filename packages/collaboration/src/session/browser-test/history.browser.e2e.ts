import { expect, test } from '@playwright/test';
import type {} from './fixture';

type Snapshot = Awaited<ReturnType<Window['historyRun']['snapshot']>>;

/**
 * Keys a Loro-driven import (undo or redo) reads back as null when the node
 * holds them absent, touched or not; text mode stays absent (Source undo/redo
 * probe log 8803f2b1). Present keys keep their values.
 */
const STORAGE_NULL_KEYS: Record<string, readonly string[]> = {
  text: ['detail', 'format', 'style'],
  paragraph: ['direction', 'indent', 'textFormat', 'textStyle'],
};
function withStoredNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withStoredNulls);
  if (!value || typeof value !== 'object') return value;
  const node: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withStoredNulls(item)])
  );
  const type = typeof node.type === 'string' ? node.type : '';
  for (const key of STORAGE_NULL_KEYS[type] ?? [])
    if (!(key in node)) node[key] = null;
  return node;
}
/** The snapshot with its content parsed, so key order does not matter. */
const parsed = (snapshot: Snapshot) => ({
  ...snapshot,
  content: JSON.parse(snapshot.content),
});
/** What a history step restores: `snapshot` after the stored-null read. */
const afterHistory = (snapshot: Snapshot) => ({
  ...snapshot,
  content: withStoredNulls(JSON.parse(snapshot.content)),
});

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
  expect(parsed(redone)).toEqual(afterHistory(committed));
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
    expect(
      parsed(await page.evaluate(() => window.historyRun.snapshot()))
    ).toEqual(afterHistory(before));
    await page.keyboard.press(shortcut);
    expect(
      parsed(await page.evaluate(() => window.historyRun.snapshot()))
    ).toEqual(afterHistory(committed));
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
    expect(
      parsed(await page.evaluate(() => window.historyRun.snapshot()))
    ).toEqual(afterHistory(typed));
  }
  await page.evaluate(() => window.historyRun.close());
  expect(errors).toEqual([]);
});
