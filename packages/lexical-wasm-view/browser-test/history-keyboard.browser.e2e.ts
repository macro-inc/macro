import { createHash } from 'node:crypto';
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
      if (engine === 'native') {
        // Native behaviour, not Source equality: the fixture installs an
        // id-less root, and native's post-Loro pass ids it on the first undo
        // (as Source's CollabProvider queues $updateAllNodeIds after a Loro
        // reconcile, C-ROOT-ID-RECONCILE-01). In this exact scenario real
        // Source loses that first undo (C-ROOT-ID-FIRST-UNDO-01); native
        // keeps it, so the redone state is the typed one plus that root id.
        expect(typed.json.root.$.id).toBeUndefined();
        expect(undone.json.root.$.id).toEqual(expect.any(String));
        expect(redone.json).toEqual({
          ...typed.json,
          root: {
            ...typed.json.root,
            $: { ...typed.json.root.$, id: undone.json.root.$.id },
          },
        });
        // Collaborative Loro history restores the surviving paragraph caret,
        // unlike the standalone Source snapshot-history fixture above.
        expect(redone.selection).toEqual({
          anchor: { path: [0], offset: 0, type: 'element' },
          focus: { path: [0], offset: 0, type: 'element' },
        });
        expect(redone.domSelection).toEqual({
          anchor: { path: [0], offset: 0 },
          focus: { path: [0], offset: 0 },
        });
      } else {
        expect(redone.json).toEqual(typed.json);
        expect(redone.selection).toEqual(typed.selection);
        expect(redone.domSelection).toEqual(typed.domSelection);
      }
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
    await root.evaluate((element) => {
      const inputs: {
        data: string | null;
        inputType: string;
        trusted: boolean;
      }[] = [];
      Reflect.set(element, '__historyTextInputs', inputs);
      element.addEventListener(
        'beforeinput',
        (event) => {
          if (event instanceof InputEvent)
            inputs.push({
              data: event.data,
              inputType: event.inputType,
              trusted: event.isTrusted,
            });
        },
        { capture: true, passive: true }
      );
    });
    await root.click();
    await page.keyboard.insertText('```');
    await page.keyboard.press('Enter');
    // Identity history uses one trusted text event, independent of per-key speed.
    await page.keyboard.insertText('const localValue = 1;x');
    await expect(root.locator('code')).toHaveText('const localValue = 1;x');
    expect(
      await root.evaluate((element) => {
        const inputs: unknown = Reflect.get(element, '__historyTextInputs');
        if (!Array.isArray(inputs)) throw new Error('Missing input capture');
        return inputs.filter(
          (input) => input.data === 'const localValue = 1;x'
        );
      })
    ).toEqual([
      {
        data: 'const localValue = 1;x',
        inputType: 'insertText',
        trusted: true,
      },
    ]);
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
      // Native ids the fixture's id-less root on the first Loro undo (see
      // the rows above, C-ROOT-ID-FIRST-UNDO-01); the id then stays stable
      // over every later cycle.
      expect(typed.json.root.$.id).toBeUndefined();
      expect(undone.json.root.$.id).toEqual(expect.any(String));
      expect(redone.json).toEqual({
        ...typed.json,
        root: {
          ...typed.json.root,
          $: { ...typed.json.root.$, id: undone.json.root.$.id },
        },
      });
      for (const earlier of cycles)
        expect(earlier.undone.json.root.$.id).toBe(undone.json.root.$.id);
      // Pin the actual collaborative Source redo policy, not snapshot history.
      expect(redone.selection).toEqual({
        anchor: { path: [0, 0], offset: 0, type: 'text' },
        focus: { path: [0, 0], offset: 0, type: 'text' },
      });
      expect(redone.domSelection).toEqual({
        anchor: { path: [], offset: 0 },
        focus: { path: [], offset: 0 },
      });
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

for (const engine of ['upstream', 'native'] as const) {
  test(`${engine} first emoji undo keeps the empty paragraph caret`, async ({
    page,
    browserName,
  }, info) => {
    test.fixme(
      engine === 'native' && browserName === 'firefox',
      '876 Firefox does not admit surrogate typing before Undo; separate input gap.'
    );
    const pageErrors: string[] = [];
    const externalAttempts: string[] = [];
    const assets: { url: string; sha256: string }[] = [];
    const assetReads: Promise<void>[] = [];
    page.on('response', (response) => {
      if (!/\.(?:js|wasm)$/.test(new URL(response.url()).pathname)) return;
      const read = async () => {
        const bytes = await response.body();
        assets.push({
          url: response.url(),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      };
      assetReads.push(read());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') {
        externalAttempts.push(url.origin);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto('/browser-test/heading-enter.html');
    await page.waitForFunction(() => Boolean(window.inputParity));
    await page.evaluate(() => window.inputParity.prepareHistory());
    const root = page.locator(`#${engine}`);
    await root.click();
    await page.keyboard.type('😀');
    await expect(root).toHaveText('😀');
    // Match the fuzz step boundary: typing has reached the actual model before Undo.
    await expect
      .poll(async () => {
        const typed = await page.evaluate(
          (engine) => window.inputParity.snapshot(engine),
          engine
        );
        return typed.json.root.children[0].children
          .map((node: { text?: string }) => node.text ?? '')
          .join('');
      })
      .toBe('😀');
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
    expect(pageErrors).toEqual([]);
    expect(externalAttempts).toEqual([]);
    expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
    await Promise.all(assetReads);
    await info.attach('first-emoji-undo', {
      body: JSON.stringify({ undone, assets }, null, 2),
      contentType: 'application/json',
    });
  });
}
