import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import type {} from './large-paste-fixture';

function canonicalModel(
  value: unknown,
  ids = new Map<string, string>()
): unknown {
  if (Array.isArray(value))
    return value.map((child) => canonicalModel(child, ids));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === '$' && child && typeof child === 'object') {
        return [
          key,
          Object.fromEntries(
            Object.entries(child).map(([name, state]) => [
              name,
              name === 'id' && typeof state === 'string'
                ? normalizedId(state, ids)
                : state,
            ])
          ),
        ];
      }
      return [key, canonicalModel(child, ids)];
    })
  );
}

function normalizedId(value: string, ids: Map<string, string>): string {
  const existing = ids.get(value);
  if (existing) return existing;
  const normalized = `<generated-id-${ids.size}>`;
  ids.set(value, normalized);
  return normalized;
}

async function paste(
  page: Page,
  engine: 'upstream' | 'native',
  html: string,
  text: string,
  browserName: string
) {
  const root = page.locator(`#${engine}`);
  await root.locator('p').click();
  if (browserName === 'webkit') {
    // WPE headless suppresses ClipboardEvent data for trusted clipboard paste.
    // Keep HTML payload delivery explicit while exercising the real DOM listener.
    return page.evaluate(
      ({ engine, html, text }) =>
        window.largePaste.paste(engine, html, text, 'synthetic'),
      { engine, html, text }
    );
  }
  await page.evaluate(
    async ({ html, text }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    },
    { html, text }
  );
  const pending = page.evaluate(
    ({ engine, html, text }) =>
      window.largePaste.paste(engine, html, text, 'trusted'),
    { engine, html, text }
  );
  await expect(root).toHaveAttribute('data-paste-ready', 'true');
  await page.keyboard.press('Control+v');
  return pending;
}

test('large HTML clipboard chapter preserves model markdown and DOM', async ({
  page,
  browserName,
}, info) => {
  const source = process.env.EDITOR_LARGE_PASTE_HTML;
  const html = source
    ? await readFile(source, 'utf8')
    : Array.from(
        { length: 83 },
        (_, i) =>
          `<p>Paragraph ${i}. ${'The sea carried the vessel through the night. '.repeat(7)}</p>`
      ).join('');
  await page.goto('/browser-test/large-paste.html');
  await page.evaluate(() => window.largePasteReady);
  const text = await page.evaluate(
    (html) =>
      new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '',
    html
  );
  const upstreamMetrics = await paste(
    page,
    'upstream',
    html,
    text,
    browserName
  );
  const upstream = await page.evaluate(() =>
    window.largePaste.snapshot('upstream')
  );
  const nativeMetrics = await paste(page, 'native', html, text, browserName);
  const native = await page.evaluate(() =>
    window.largePaste.snapshot('native')
  );
  await info.attach('large-paste', {
    body: JSON.stringify(
      {
        bytes: Buffer.byteLength(html),
        sha256: createHash('sha256').update(html).digest('hex'),
        upstreamMetrics,
        nativeMetrics,
        performanceAcceptance: false,
        webkitScope:
          browserName === 'webkit'
            ? 'Linux engine proxy; not Safari'
            : undefined,
        upstream,
        native,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  expect.soft(nativeMetrics.types).toContain('text/html');
  expect.soft(upstreamMetrics.types).toContain('text/html');
  expect.soft(nativeMetrics.prevented).toBe(true);
  expect.soft(upstreamMetrics.prevented).toBe(true);
  expect.soft(native.text).toEqual(upstream.text);
  expect.soft(native.paragraphs).toEqual(upstream.paragraphs);
  expect
    .soft(canonicalModel(JSON.parse(native.model)))
    .toEqual(canonicalModel(JSON.parse(upstream.model)));
  expect.soft(native.markdown).toEqual(upstream.markdown);
  // Retain strict DOM comparison. Engine-internal attributes require a reviewed allowlist.
  expect.soft(native.dom).toEqual(upstream.dom);
  // Managed-browser timing is diagnostic; performance acceptance uses stock browsers.
  expect(await page.evaluate(() => window.largePaste.errors)).toEqual([]);
});

test('whitespace named anchor paste preserves upstream model and markdown', async ({
  page,
  browserName,
}, info) => {
  const html =
    '<a id="chapter"> \n<!-- anchor --> </a><h2>Chapter</h2><p>text</p>';
  await page.goto('/browser-test/large-paste.html');
  await page.evaluate(() => window.largePasteReady);
  await paste(page, 'upstream', html, 'Chaptertext', browserName);
  const upstream = await page.evaluate(() =>
    window.largePaste.snapshot('upstream')
  );
  await paste(page, 'native', html, 'Chaptertext', browserName);
  const native = await page.evaluate(() =>
    window.largePaste.snapshot('native')
  );
  await info.attach('named-anchor', {
    body: JSON.stringify({ upstream, native }, null, 2),
    contentType: 'application/json',
  });
  expect
    .soft(canonicalModel(JSON.parse(native.model)))
    .toEqual(canonicalModel(JSON.parse(upstream.model)));
  expect.soft(native.markdown).toEqual(upstream.markdown);
  await expect.soft(page.locator('#native a > br')).toHaveCount(0);
  expect(await page.evaluate(() => window.largePaste.errors)).toEqual([]);
});
