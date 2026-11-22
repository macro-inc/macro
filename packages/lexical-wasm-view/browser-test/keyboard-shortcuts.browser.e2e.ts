import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type {} from './heading-enter-fixture';

for (const platform of ['Linux x86_64', 'MacIntel']) {
  for (const engine of ['upstream', 'native'] as const) {
    test(`${engine} ${platform} platform shortcut selects all paragraphs`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      const external: string[] = [];
      const assets: { url: string; sha256: string }[] = [];
      const reads: Promise<void>[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (!/\.(?:js|wasm)$/.test(new URL(response.url()).pathname)) return;
        const read = async () => {
          assets.push({
            url: response.url(),
            sha256: createHash('sha256')
              .update(await response.body())
              .digest('hex'),
          });
        };
        reads.push(read());
      });
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
          external.push(route.request().url());
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.addInitScript(
        (platform) =>
          Object.defineProperty(navigator, 'platform', { value: platform }),
        platform
      );
      await page.goto('/browser-test/heading-enter.html');
      await page.waitForFunction(() => Boolean(window.inputParity));
      await page.evaluate(() => window.inputParity.prepareHistory());
      const root = page.locator(`#${engine}`);
      await root.click();
      await page.keyboard.type('first');
      await page.keyboard.press('Enter');
      await page.keyboard.type('second');
      await expect
        .poll(async () => {
          const state = await page.evaluate(
            (engine) => window.inputParity.snapshot(engine),
            engine
          );
          return state.json.root.children.map(
            (p: { children: { text?: string }[] }) =>
              p.children.map((n) => n.text ?? '').join('')
          );
        })
        .toEqual(['first', 'second']);
      await page.keyboard.press(
        platform === 'MacIntel' ? 'Meta+a' : 'Control+a'
      );
      const selected = await page.evaluate(
        (engine) => window.inputParity.snapshot(engine),
        engine
      );
      expect(selected.selection).toEqual({
        anchor: { path: [0, 0], offset: 0, type: 'text' },
        focus: { path: [1, 0], offset: 6, type: 'text' },
      });
      const selectedText = await page.evaluate(() =>
        getSelection()?.toString()
      );
      expect(selectedText).toContain('first');
      expect(selectedText).toContain('second');
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
      await Promise.all(reads);
      await info.attach('platform-select-all', {
        body: JSON.stringify({ selected, selectedText, assets }, null, 2),
        contentType: 'application/json',
      });
    });

    test(`${engine} ${platform} platform undo and redo`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const external: string[] = [];
      const assets: { url: string; sha256: string }[] = [];
      const reads: Promise<void>[] = [];
      page.on('response', (response) => {
        if (!/\.(?:js|wasm)$/.test(new URL(response.url()).pathname)) return;
        const read = async () => {
          assets.push({
            url: response.url(),
            sha256: createHash('sha256')
              .update(await response.body())
              .digest('hex'),
          });
        };
        reads.push(read());
      });
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
          external.push(route.request().url());
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.addInitScript(
        (platform) =>
          Object.defineProperty(navigator, 'platform', { value: platform }),
        platform
      );
      await page.goto('/browser-test/heading-enter.html');
      await page.waitForFunction(() => Boolean(window.inputParity));
      await page.evaluate(() => window.inputParity.prepareHistory());
      const root = page.locator(`#${engine}`);
      await root.click();
      await page.keyboard.type('x');
      await expect
        .poll(async () => {
          const state = await page.evaluate(
            (engine) => window.inputParity.snapshot(engine),
            engine
          );
          return state.json.root.children
            .flatMap((p: { children: { text?: string }[] }) => p.children)
            .map((n: { text?: string }) => n.text ?? '')
            .join('');
        })
        .toBe('x');
      await page.keyboard.press(
        platform === 'MacIntel' ? 'Meta+z' : 'Control+z'
      );
      await expect(root).toHaveText('');
      await page.keyboard.press(
        platform === 'MacIntel' ? 'Meta+Shift+z' : 'Control+Shift+z'
      );
      await expect(root).toHaveText('x');
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
      expect(external).toEqual([]);
      await Promise.all(reads);
      await info.attach('platform-history', {
        body: JSON.stringify({ assets }, null, 2),
        contentType: 'application/json',
      });
    });
  }
}
