import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const fixture = window.nativeUserMenu;
    if (!fixture) throw new Error('Missing actual user mention fixture');
    const selection = document.getSelection();
    const point = (node: Node | null, offset: number) =>
      node ? { name: node.nodeName, text: node.textContent, offset } : null;
    return {
      ...fixture.capture(),
      anchor: point(
        selection?.anchorNode ?? null,
        selection?.anchorOffset ?? 0
      ),
      focus: point(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
    };
  });
}

async function prepare(page: Page, engine: 'source' | 'native', end: boolean) {
  await page.goto('/user-mentions.html?engine=' + engine);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('@User');
  await expect(
    page.locator('.menu-surface [title="Example User fixture@example.com"]')
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(body.locator('[data-user-mention]')).toHaveCount(1);
  await page.keyboard.type(' after words');
  await expect(body).toContainText('after words');
  // Supply only the initial browser caret. The real selectionchange listeners
  // admit it before the trusted key; no model selection is fabricated.
  await page.evaluate(async (end) => {
    const root = document.getElementById('body');
    const paragraph = root?.querySelector('p');
    if (!root || !paragraph) throw new Error('Missing actual paragraph');
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.includes('after words')) {
        text = walker.currentNode;
        break;
      }
    }
    if (!text) throw new Error('Missing actual following text');
    const changed = new Promise<void>((resolve) =>
      document.addEventListener('selectionchange', () => resolve(), {
        once: true,
      })
    );
    const range = document.createRange();
    range.setStart(end ? paragraph : text, 0);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    await changed;
  }, end);
  return body;
}

for (const direction of ['start', 'end'] as const) {
  test(
    'word ' +
      direction +
      ' around the actual leading mention matches Source caret and subsequent typing',
    async ({ page }, info) => {
      const errors: string[] = [];
      const servedWasm: Promise<{ url: string; sha256: string }>[] = [];
      page.on('response', (response) => {
        if (!new URL(response.url()).pathname.endsWith('.wasm')) return;
        servedWasm.push(
          response.body().then((body) => ({
            url: response.url(),
            sha256: createHash('sha256').update(body).digest('hex'),
          }))
        );
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (url.pathname === '/auth/user/profile_pictures')
          return route.fulfill({ json: { pictures: [] } });
        return route.continue();
      });
      const results = [];
      for (const engine of ['source', 'native'] as const) {
        const body = await prepare(page, engine, direction === 'end');
        const before = await snapshot(page);
        await page.keyboard.press(
          direction === 'start' ? 'Control+ArrowLeft' : 'Control+ArrowRight'
        );
        const after = await snapshot(page);
        await page.keyboard.type('Z');
        await expect(body.locator('[data-user-mention]')).toHaveCount(1);
        await expect(body).toContainText('Z');
        const typed = await snapshot(page);
        results.push({ engine, before, after, typed });
      }
      await info.attach('literal-source-native-word-input', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });
      expect(results[1].after.anchor).toEqual(results[0].after.anchor);
      expect(results[1].after.focus).toEqual(results[0].after.focus);
      expect(results[1].typed.anchor).toEqual(results[0].typed.anchor);
      expect(results[1].typed.focus).toEqual(results[0].typed.focus);
      const served = await Promise.all(servedWasm);
      await info.attach('actual-served-native-wasm', {
        body: JSON.stringify(served, null, 2),
        contentType: 'application/json',
      });
      const expectedWasm =
        process.env.NATIVE_WORD_WASM_SHA ??
        createHash('sha256')
          .update(
            readFileSync(
              new URL(
                '../../../../document-session/wasm/document_session_wasm_bg.wasm',
                import.meta.url
              )
            )
          )
          .digest('hex');
      expect(served).toHaveLength(1);
      expect(served[0].sha256).toBe(expectedWasm);
      expect(errors).toEqual([]);
    }
  );
}
