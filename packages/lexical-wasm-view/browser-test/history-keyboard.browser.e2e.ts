import { expect, test } from '@playwright/test';
import type {} from './heading-enter-fixture';

for (const engine of ['upstream', 'native'] as const) {
  for (const redo of ['Control+Shift+z', 'Control+y']) {
    test(`${engine} keyboard undo and ${redo} restore text and caret`, async ({
      page,
    }, info) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto('/browser-test/heading-enter.html');
      await page.waitForFunction(() => Boolean(window.inputParity));
      await page.evaluate(() => window.inputParity.prepareHistory());
      const root = page.locator(`#${engine}`);
      const initial = await page.evaluate(
        (engine) => window.inputParity.snapshot(engine),
        engine
      );
      expect(initial.json.root.children).toHaveLength(1);
      expect(initial.json.root.children[0].type).toBe('paragraph');
      expect(initial.json.root.children[0].children).toEqual([]);
      await root.click();
      await page.keyboard.type('a');
      await expect(root).toHaveText('a');
      const typed = await page.evaluate(
        (engine) => window.inputParity.snapshot(engine),
        engine
      );
      expect(typed.json.root.children).toHaveLength(1);
      expect(typed.json.root.children[0].type).toBe('paragraph');
      expect(
        typed.json.root.children[0].children.map(
          (node: { type: string; text: string }) => ({
            type: node.type,
            text: node.text,
          })
        )
      ).toEqual([{ type: 'text', text: 'a' }]);
      expect(typed.selection).toEqual({
        anchor: { path: [0, 0], offset: 1, type: 'text' },
        focus: { path: [0, 0], offset: 1, type: 'text' },
      });
      expect(typed.domSelection).toEqual({
        anchor: { path: [0, 0, 0], offset: 1 },
        focus: { path: [0, 0, 0], offset: 1 },
      });
      await page.keyboard.press('Control+z');
      await expect(root).toHaveText('');
      const undone = await page.evaluate(
        (engine) => window.inputParity.snapshot(engine),
        engine
      );
      expect(undone.json.root.children).toHaveLength(1);
      expect(undone.json.root.children[0].type).toBe('paragraph');
      expect(undone.json.root.children[0].children).toEqual([]);
      expect(undone.selection).toEqual({
        anchor: { path: [0], offset: 0, type: 'element' },
        focus: { path: [0], offset: 0, type: 'element' },
      });
      expect(undone.domSelection).toEqual({
        anchor: { path: [0], offset: 0 },
        focus: { path: [0], offset: 0 },
      });
      await page.keyboard.press(redo);
      await expect(root).toHaveText('a');
      const redone = await page.evaluate(
        (engine) => window.inputParity.snapshot(engine),
        engine
      );
      expect(redone.json).toEqual(typed.json);
      expect(redone.selection).toEqual(typed.selection);
      expect(redone.domSelection).toEqual(typed.domSelection);
      expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
      expect(pageErrors).toEqual([]);
      await info.attach('keyboard-history', {
        body: JSON.stringify({ typed, undone, redone }, null, 2),
        contentType: 'application/json',
      });
    });
  }
}

for (const redo of ['Control+Shift+z', 'Control+y']) {
  test(`native code subtree keyboard undo and ${redo} preserve durable identities`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/browser-test/heading-enter.html');
    await page.waitForFunction(() => Boolean(window.inputParity));
    await page.evaluate(() => window.inputParity.prepareHistory());
    const root = page.locator('#native');
    await root.click();
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const localValue = 1;x');
    await expect(root.locator('code')).toHaveText('const localValue = 1;x');
    const typed = await page.evaluate(() =>
      window.inputParity.snapshot('native')
    );
    expect(typed.json.root.children[0].type).toBe('custom-code');
    expect(typed.json.root.children[0].$?.id).toEqual(expect.any(String));
    expect(typed.json.root.children[0].children[0].$?.id).toEqual(
      expect.any(String)
    );
    expect(typed.selection).toEqual({
      anchor: { path: [0, 0], offset: 22, type: 'text' },
      focus: { path: [0, 0], offset: 22, type: 'text' },
    });
    expect(typed.domSelection).toEqual({
      anchor: { path: [0, 0, 0], offset: 22 },
      focus: { path: [0, 0, 0], offset: 22 },
    });
    const cycles = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.keyboard.press('Control+z');
      await expect(root.locator('code')).toHaveCount(0);
      const undone = await page.evaluate(() =>
        window.inputParity.snapshot('native')
      );
      await page.keyboard.press(redo);
      await expect(root.locator('code')).toHaveText('const localValue = 1;x');
      const redone = await page.evaluate(() =>
        window.inputParity.snapshot('native')
      );
      expect(redone.json).toEqual(typed.json);
      expect(redone.selection).toEqual(typed.selection);
      expect(redone.domSelection).toEqual(typed.domSelection);
      cycles.push({ undone, redone });
    }
    expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach('code-subtree-history', {
      body: JSON.stringify({ typed, cycles }, null, 2),
      contentType: 'application/json',
    });
  });
}
