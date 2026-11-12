import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const nativeWasmSHA256 = createHash('sha256')
  .update(
    readFileSync(
      new URL(
        '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    )
  )
  .digest('hex');

for (const [platform, userAgent] of [
  ['MacIntel', 'Mozilla/5.0 (Windows NT 10.0)'],
  ['Linux x86_64', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'],
]) {
  for (const engine of ['upstream', 'native']) {
    test(`${engine} checklist modifier Enter: ${platform} / ${userAgent}`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      const assets: { url: string; sha256: string }[] = [];
      const reads: Promise<void>[] = [];
      page.on('response', (response) => {
        if (!/\.(?:js|wasm)$/.test(new URL(response.url()).pathname)) return;
        reads.push(
          response.body().then((bytes) => {
            assets.push({
              url: response.url(),
              sha256: createHash('sha256').update(bytes).digest('hex'),
            });
          })
        );
      });
      const external: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
          external.push(route.request().url());
          await route.abort();
        } else await route.continue();
      });
      await page.addInitScript(
        ({ platform, userAgent }) => {
          Object.defineProperty(navigator, 'platform', { value: platform });
          Object.defineProperty(navigator, 'userAgent', { value: userAgent });
        },
        { platform, userAgent }
      );
      await page.goto('/browser-test/checklist-platform.html');
      await page.waitForFunction(() =>
        Reflect.has(window, 'checklistPlatformErrors')
      );
      const root = page.locator(`#${engine}`);
      const item = root.locator('li');
      await expect(item).toHaveAttribute('aria-checked', 'false');
      await item.click();
      await page.keyboard.press('Meta+Enter');
      await expect(item).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Meta+Enter');
      await expect(item).toHaveAttribute('aria-checked', 'false');
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      expect(
        await page.evaluate(() =>
          Reflect.get(window, 'checklistPlatformErrors')
        )
      ).toEqual([]);
      await Promise.all(reads);
      expect(
        assets
          .filter((asset) => asset.url.endsWith('.wasm'))
          .map((asset) => asset.sha256)
      ).toEqual([nativeWasmSHA256]);
      await info.attach('checklist-platform', {
        body: JSON.stringify({
          platform,
          userAgent,
          assets,
          html: await root.innerHTML(),
        }),
        contentType: 'application/json',
      });
    });
  }
}
