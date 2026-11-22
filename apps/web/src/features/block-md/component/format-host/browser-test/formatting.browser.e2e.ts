import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

async function selectPhrase(
  page: Page,
  start = 0,
  end = 18,
  backward = false,
  expected = 'Select this phrase'.slice(start, end)
) {
  await page.locator('#body').focus();
  await page.locator('#body').evaluate(
    (root, { start, end, backward }) => {
      const text = document
        .createTreeWalker(root, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text) throw new Error('Expected rendered Source text');
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      const selection = root.ownerDocument.getSelection();
      if (!selection) throw new Error('Expected browser selection');
      selection.removeAllRanges();
      selection.addRange(range);
      if (backward) selection.setBaseAndExtent(text, end, text, start);
    },
    { start, end, backward }
  );
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe(expected);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

const hash = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
let servedScripts: Promise<{
  url: string;
  sha256: string;
  mapSHA256: string;
}>[] = [];
const seenCompiledSources = new Set<string>();
const servedWasm: { url: string; sha256: string }[] = [];
const pins = new Map([
  [
    'Lexical.prod.mjs',
    '4678405ecd2750dae7e76a2ad704251f8112cfaa95fe028349f93f1dad1f964a',
  ],
  [
    'LexicalCodeCore.prod.mjs',
    'fc4fb7f8abc2ba2fcb4b2d60f8ae9b95dadf0c866c7bca7dc770a1f931967f24',
  ],
]);

test.beforeEach(async ({ page }) => {
  servedScripts = [];
  seenCompiledSources.clear();
  servedWasm.length = 0;
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (
      process.env.NATIVE_FORMAT_ENGINE === 'native' &&
      url.hostname === '127.0.0.1' &&
      url.pathname.endsWith('.wasm')
    ) {
      const build = process.env.NATIVE_FORMAT_BUILD;
      if (!build) throw new Error('Missing exact native formatting build');
      const digest = hash(readFileSync(join(build, 'dist', url.pathname)));
      expect(digest).toBe(
        '0fcf8aa440b4beaab418edda3b52d685ca4b1d9d424001af64ac07a8ac437bc4'
      );
      servedWasm.push({ url: request.url(), sha256: digest });
    }
    if (
      url.hostname !== '127.0.0.1' ||
      !url.pathname.startsWith('/assets/') ||
      !url.pathname.endsWith('.js')
    )
      return;
    const build = process.env.NATIVE_FORMAT_BUILD;
    if (!build) throw new Error('Missing exact formatting build');
    const file = join(build, 'dist', url.pathname);
    const body = readFileSync(file);
    const map = readFileSync(file + '.map');
    const sourceMap: { sources: string[]; sourcesContent: string[] } =
      JSON.parse(map.toString());
    for (let index = 0; index < sourceMap.sources.length; index++) {
      const name = sourceMap.sources[index]?.split('/').pop();
      const expected = name && pins.get(name);
      if (expected && name) {
        expect(hash(sourceMap.sourcesContent[index] ?? '')).toBe(expected);
        seenCompiledSources.add(name);
      }
    }
    servedScripts.push(
      Promise.resolve({
        url: request.url(),
        sha256: hash(body),
        mapSHA256: hash(map),
      })
    );
  });
  await page.routeWebSocket(
    (url) => url.hostname !== '127.0.0.1',
    (socket) => socket.close()
  );
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort()
  );
});

test.afterEach(async ({ page }, info) => {
  await info.attach('page-url', {
    body: page.url(),
    contentType: 'text/plain',
  });
  if (process.env.NATIVE_FORMAT_ENGINE === 'native') {
    expect(servedWasm).toHaveLength(1);
    await info.attach('actual-native-wasm-integrity', {
      body: JSON.stringify(servedWasm),
      contentType: 'application/json',
    });
  }
  const scripts = await Promise.all(servedScripts);
  expect(scripts.length).toBeGreaterThan(0);
  expect([...seenCompiledSources].sort()).toEqual([...pins.keys()].sort());
  await info.attach('served-javascript-integrity', {
    body: JSON.stringify(scripts, null, 2),
    contentType: 'application/json',
  });
});

test('document FormatTools formats a real expanded selection without losing its text', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await selectPhrase(page);
  const toolbar = page.getByRole('toolbar', { name: 'Document formatting' });
  await toolbar.getByRole('button').first().click();
  await expect(page.locator('#body strong,#body b')).toHaveText(
    'Select this phrase'
  );
  await expect(page.locator('#body')).toHaveText('Select this phrase');
});

for (const variant of ['document', 'floating']) {
  test(`${variant} format toolbar creates a link from the real selection through Enter`, async ({
    page,
  }) => {
    await page.goto(variant === 'floating' ? '/?floating' : '/');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await selectPhrase(page);
    const toolbar = page.getByRole('toolbar');
    await expect(toolbar).toBeVisible();
    // Actual Source icon order; this is not an accessibility-name assertion.
    await toolbar.getByRole('button').nth(2).click();
    await page
      .getByPlaceholder('https://example.com', { exact: true })
      .fill('https://example.com/selected');
    await expect(
      page.getByPlaceholder('Link text', { exact: true })
    ).toHaveValue('Select this phrase');
    await page.keyboard.press('Enter');
    await expect(
      page
        .locator('#body')
        .getByRole('link', { name: 'Select this phrase', exact: true })
    ).toHaveAttribute('href', 'https://example.com/selected');
    await expect(page.locator('#body')).toBeFocused();
  });
}

for (const variant of [
  { label: 'full forward', start: 0, end: 18, backward: false },
  { label: 'partial forward', start: 7, end: 11, backward: false },
  { label: 'partial backward', start: 7, end: 11, backward: true },
]) {
  test(
    variant.label +
      ' expanded Link cancel preserves the empty link and selected text like Source',
    async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      await selectPhrase(page, variant.start, variant.end, variant.backward);
      const before = await page.locator('#body').evaluate((root) => {
        const selection = root.ownerDocument.getSelection();
        return {
          anchor: selection?.anchorOffset,
          focus: selection?.focusOffset,
          text: selection?.toString(),
        };
      });
      await page.getByRole('toolbar').getByRole('button').nth(2).click();
      await expect(
        page.getByPlaceholder('https://example.com', { exact: true })
      ).toBeFocused();
      const prepared = page.locator('#body a');
      await expect(prepared).toHaveCount(1);
      await expect(prepared).toHaveAttribute('href', 'https://');
      await expect(prepared).toHaveText(
        'Select this phrase'.slice(variant.start, variant.end)
      );
      const preparedState = await page.locator('#live-state').textContent();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      // Source currently retains the empty model URL on expanded cancel.
      // Retain parity until the OFF and native paths receive the same product fix.
      await expect(page.locator('#body a')).toHaveCount(1);
      await expect(page.locator('#live-state')).toHaveText(preparedState ?? '');
      await expect(page.locator('#body')).toHaveText('Select this phrase');
      await expect(page.locator('#body')).toBeFocused();
      await expect
        .poll(() =>
          page.locator('#body').evaluate((root) => {
            const selection = root.ownerDocument.getSelection();
            return {
              anchor: selection?.anchorOffset,
              focus: selection?.focusOffset,
              text: selection?.toString(),
            };
          })
        )
        .toEqual({
          anchor: variant.backward ? variant.end - variant.start : 0,
          focus: variant.backward ? 0 : variant.end - variant.start,
          text: before.text,
        });
      await page.getByRole('toolbar').getByRole('button').nth(2).click();
      await expect(page.locator('#body a')).toHaveCount(0);
      await expect(page.locator('#body')).toHaveText('Select this phrase');
      await expect
        .poll(() => page.evaluate(() => getSelection()?.toString()))
        .toBe(before.text);
    }
  );
}

for (const backward of [false, true]) {
  test(`format facts use document order for a mixed ${backward ? 'backward' : 'forward'} range`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await page
      .getByRole('button', { name: 'Load formatting facts', exact: true })
      .click();
    await page.locator('#body').focus();
    await page.locator('#body').evaluate((root, backward) => {
      const first = root.querySelector('p')?.firstChild?.firstChild;
      const last = root.querySelector('h6')?.firstChild?.firstChild;
      if (!first || !last)
        throw new Error('Missing actual Source text endpoints');
      const selection = root.ownerDocument.getSelection();
      if (!selection) throw new Error('Missing browser selection');
      selection.setBaseAndExtent(
        backward ? last : first,
        backward ? 3 : 0,
        backward ? first : last,
        backward ? 0 : 3
      );
    }, backward);
    await expect
      .poll(async () =>
        JSON.parse(
          (await page.locator('#selection-facts').textContent()) ?? 'null'
        )
      )
      .toEqual({
        format: 0,
        hasLinks: true,
        elementsInRange: ['paragraph', 'heading4', 'heading6'],
      });
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+i');
    await expect
      .poll(async () =>
        JSON.parse(
          (await page.locator('#selection-facts').textContent()) ?? 'null'
        )
      )
      .toEqual({
        format: 3,
        hasLinks: true,
        elementsInRange: ['paragraph', 'heading4', 'heading6'],
      });
  });
}

test('collapsed text inside a link reports Source link formatting', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page
    .getByRole('button', { name: 'Load formatting facts', exact: true })
    .click();
  await page.locator('#body').focus();
  await page.locator('#body').evaluate((root) => {
    const text = root.querySelector('a')?.firstChild?.firstChild;
    if (!text) throw new Error('Missing actual Source link text');
    const selection = root.ownerDocument.getSelection();
    if (!selection) throw new Error('Missing browser selection');
    selection.setBaseAndExtent(text, 2, text, 2);
  });
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.locator('#selection-facts').textContent()) ?? 'null'
      )
    )
    .toEqual({
      format: 0,
      hasLinks: true,
      elementsInRange: ['paragraph'],
    });
});

for (const format of [
  { label: 'Strikethrough', selector: '.md-strike' },
  { label: 'Inline code', selector: 'code' },
  { label: 'Highlight', selector: 'mark' },
]) {
  test(`Source More first click toggles ${format.label} on and off`, async ({
    page,
  }, info) => {
    await page.goto('/?floating');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    const body = page.locator('#body');
    await body.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('left middle right');
    await expect(body).toHaveText('left middle right');
    await selectPhrase(page, 5, 11, false, 'middle');
    const toolbar = page.getByRole('toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button').nth(3).click();
    await page.getByRole('button', { name: format.label, exact: true }).click();
    await info.attach('first-click-format', {
      body: JSON.stringify({
        facts: await page.locator('#selection-facts').textContent(),
        state: await page.locator('#live-state').textContent(),
        dom: await body.innerHTML(),
      }),
      contentType: 'application/json',
    });
    await expect(body.locator(format.selector)).toHaveText('middle');
    await expect(body).toHaveText('left middle right');
    await page.getByRole('button', { name: format.label, exact: true }).click();
    await expect(body.locator(format.selector)).toHaveCount(0);
    await expect(body).toHaveText('left middle right');
  });
}

for (const variant of ['document', 'floating']) {
  for (const format of [
    { label: 'Bold', selector: 'strong,b' },
    { label: 'Italic', selector: 'em,i' },
  ]) {
    test(`${variant} toolbar toggles ${format.label} on and off without changing the selected label`, async ({
      page,
    }) => {
      await page.goto(variant === 'floating' ? '/?floating' : '/');
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      const body = page.locator('#body');
      await body.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('left middle right');
      await selectPhrase(page, 5, 11, false, 'middle');
      const toolbar = page.getByRole('toolbar');
      await expect(toolbar).toBeVisible();
      const button = toolbar.getByRole('button', {
        name: format.label,
        exact: true,
      });
      await button.click();
      await expect(body.locator(format.selector)).toHaveText('middle');
      await expect(body).toHaveText('left middle right');
      await button.click();
      await expect(body.locator(format.selector)).toHaveCount(0);
      await expect(body).toHaveText('left middle right');
    });
  }
}

test('document block toolbar toggles Heading 2 with retained text and selection', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const body = page.locator('#body');
  await selectPhrase(page);
  const text = await body.evaluateHandle((root) => {
    const actual = root.ownerDocument
      .createTreeWalker(root, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!actual) throw new Error('Missing actual rendered text');
    return actual;
  });
  const toolbar = page.getByRole('toolbar', { name: 'Document formatting' });
  await toolbar.getByRole('button', { name: 'Body', exact: true }).click();
  await page
    .getByRole('menuitemradio', { name: 'Heading 2', exact: true })
    .click();
  await expect(body.locator('h2')).toHaveText('Select this phrase');
  await expect
    .poll(() =>
      text.evaluate(
        (node) =>
          node.isConnected && node.parentElement?.closest('h2')?.textContent
      )
    )
    .toBe('Select this phrase');
  await toolbar.getByRole('button', { name: 'Heading 2', exact: true }).click();
  await page
    .getByRole('menuitemradio', { name: 'Heading 2', exact: true })
    .click();
  await expect(body.locator('h2')).toHaveCount(0);
  await expect(body.locator('p')).toHaveText('Select this phrase');
  await expect
    .poll(() =>
      text.evaluate(
        (node) =>
          node.isConnected && node.parentElement?.closest('p')?.textContent
      )
    )
    .toBe('Select this phrase');
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('Select this phrase');
  await text.dispose();
});
