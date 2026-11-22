import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';

const DIST =
  process.env.EDITOR_OVERLAYS_DIST ??
  fileURLToPath(
    new URL(
      '../../../../../../../node_modules/.drag-overlays-dist/',
      import.meta.url
    )
  );
const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const CORE = new Map([
  [
    'lexical/dist/Lexical.prod.mjs',
    '4678405ecd2750dae7e76a2ad704251f8112cfaa95fe028349f93f1dad1f964a',
  ],
  [
    '@lexical/code-core/dist/LexicalCodeCore.prod.mjs',
    'fc4fb7f8abc2ba2fcb4b2d60f8ae9b95dadf0c866c7bca7dc770a1f931967f24',
  ],
]);

// Every isolated fixture file shares native input setup and diagnostic capture.
export function installBrowserHooks(path = '/') {
  const PAGE_ERRORS = new WeakMap<Page, string[]>();
  const EXTERNAL = new WeakMap<Page, string[]>();
  const CODE = new WeakMap<
    Page,
    Array<Promise<{ url: string; bytes: Buffer }>>
  >();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    PAGE_ERRORS.set(page, errors);
    const external: string[] = [];
    EXTERNAL.set(page, external);
    const code: Array<Promise<{ url: string; bytes: Buffer }>> = [];
    CODE.set(page, code);
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.hostname === '127.0.0.1' && /\.(js|wasm)$/.test(url.pathname)) {
        code.push(
          (async () => ({
            url: response.url(),
            bytes: await response.body(),
          }))()
        );
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket(
      (url) => url.hostname !== '127.0.0.1',
      async (socket) => {
        external.push(socket.url());
        await socket.close();
      }
    );
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      external.push(url.origin);
      return route.abort();
    });
    await page.goto(
      process.env.DRAG_ENGINE === 'native'
        ? `/native.html${new URL(path, 'http://fixture').search}`
        : path
    );
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  });

  test.afterEach(async ({ page }, info) => {
    await info.attach('accessibility', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    });
    await info.attach('pixels', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Save state', exact: true }).click();
    await info.attach('serialized-and-markdown', {
      body: await page.locator('#saved').innerText(),
      contentType: 'application/json',
    });
    const witnesses = [];
    const compiledCore = new Set<string>();
    for (const response of await Promise.all(CODE.get(page) ?? [])) {
      const url = new URL(response.url);
      const file = url.pathname.slice(1);
      const sha256 = hash(response.bytes);
      expect(sha256).toBe(hash(await readFile(DIST + file)));
      witnesses.push({ file, sha256 });
      const sourceMap = response.bytes
        .toString()
        .slice(-500)
        .match(/sourceMappingURL=([^\s]+)/)?.[1];
      if (!sourceMap) continue;
      const mapURL = new URL(sourceMap, url);
      const localMap = await readFile(DIST + mapURL.pathname.slice(1));
      const parsed = JSON.parse(localMap.toString());
      for (let index = 0; index < parsed.sources.length; index++) {
        for (const [suffix, expected] of CORE) {
          if (!parsed.sources[index].endsWith(suffix)) continue;
          const actualMap = await page.request.get(mapURL.href);
          expect(hash(await actualMap.body())).toBe(hash(localMap));
          expect(hash(parsed.sourcesContent[index])).toBe(expected);
          compiledCore.add(suffix);
          witnesses.push({
            file: mapURL.pathname,
            sha256: hash(localMap),
            compiledSource: suffix,
            sourceSha256: expected,
          });
        }
      }
    }
    if (process.env.DRAG_ENGINE !== 'native')
      expect([...compiledCore].sort()).toEqual([...CORE.keys()].sort());
    await info.attach('served-code-provenance', {
      body: JSON.stringify(witnesses),
      contentType: 'application/json',
    });
    expect(PAGE_ERRORS.get(page)).toEqual([]);
    expect(EXTERNAL.get(page)).toEqual([]);
  });
}

export async function toggleChecklistMarker(
  page: Page,
  check: Locator,
  hasTouch: boolean
) {
  await check.scrollIntoViewIfNeeded();
  const point = await check.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const marker = getComputedStyle(element, '::before');
    return {
      clientX:
        bounds.left + parseFloat(marker.left) + parseFloat(marker.width) / 2,
      clientY:
        bounds.top + parseFloat(marker.top) + parseFloat(marker.height) / 2,
    };
  });
  expect(
    await check.evaluate(
      (element, point) =>
        document.elementFromPoint(point.clientX, point.clientY) === element,
      point
    )
  ).toBe(true);
  // Native input uses the visual viewport; DOM rects use the layout viewport.
  const viewport = await page.evaluate(() => ({
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
  }));
  const x = point.clientX - viewport.left;
  const y = point.clientY - viewport.top;
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
