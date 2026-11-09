import { expect, test } from '@playwright/test';
import type {} from './heading-enter-fixture';

test('heading shortcut then Enter creates exactly one paragraph and caret', async ({
  page,
}, info) => {
  await page.goto('/browser-test/heading-enter.html');
  await page.waitForFunction(() => Boolean(window.inputParity));
  for (const engine of ['upstream', 'native'] as const) {
    const root = page.locator(`#${engine}`);
    await root.click();
    await page.keyboard.type('# title');
    await page.keyboard.press('Enter');
    const snapshot = await page.evaluate(
      (engine) => window.inputParity.snapshot(engine),
      engine
    );
    await info.attach(engine, {
      body: JSON.stringify(snapshot, null, 2),
      contentType: 'application/json',
    });
    await expect.soft(root.locator(':scope > h1')).toHaveText('title');
    await expect.soft(root.locator(':scope > p')).toHaveCount(1);
    expect
      .soft(
        snapshot.json.root.children.map((node: { type: string }) => node.type)
      )
      .toEqual(['heading', 'paragraph']);
    expect.soft(snapshot.selection).toEqual({
      anchor: { path: [1], offset: 0, type: 'element' },
      focus: { path: [1], offset: 0, type: 'element' },
    });
    expect.soft(snapshot.domSelection).toEqual({
      anchor: { path: [1], offset: 0 },
      focus: { path: [1], offset: 0 },
    });
  }
  expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
});
