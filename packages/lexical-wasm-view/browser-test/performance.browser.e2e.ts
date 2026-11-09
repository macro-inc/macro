import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type {} from './performance-fixture';

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid OTLP object');
  return Reflect.get(value, key);
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid OTLP array');
  return value;
}

test('real native paste, reconcile and scroll export sampled facade spans without content', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Trusted clipboard smoke uses Chromium permissions'
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/browser-test/performance.html');
  await page.evaluate(() => window.editorPerformanceReady);
  const before = await page.evaluate(() => window.editorPerformance.model());
  await page.locator('#editor p').first().click();
  await page.evaluate(async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob(['<p>Clipboard performance marker</p>'], {
          type: 'text/html',
        }),
        'text/plain': new Blob(['Clipboard performance marker'], {
          type: 'text/plain',
        }),
      }),
    ]);
    window.editorPerformance.blockNextPaste();
  });
  await page.keyboard.press('Control+v');
  await expect(page.locator('#editor')).toContainText(
    'Clipboard performance marker'
  );
  await page.evaluate(() => window.editorPerformance.flush());
  await page.mouse.move(300, 160);
  await page.mouse.wheel(0, 200);
  await page.evaluate(() => window.editorPerformance.flush());
  await page.evaluate(() => window.editorPerformance.stopScroll());
  const result = await page.evaluate(() => window.editorPerformance.flush());
  await writeFile(
    test.info().outputPath('editor-performance-otlp.json'),
    JSON.stringify(result.batches)
  );
  expect(result.errors).toEqual([]);
  const spans = result.batches.flatMap((body) =>
    array(field(JSON.parse(body), 'resourceSpans')).flatMap((resource) =>
      array(field(resource, 'scopeSpans')).flatMap((scope) =>
        array(field(scope, 'spans'))
      )
    )
  );
  expect(spans.map((span) => field(span, 'name'))).toEqual(
    expect.arrayContaining([
      'editor.paste',
      'editor.reconcile',
      'editor.scroll',
    ])
  );
  const paste = spans.find(
    (span) =>
      field(span, 'name') === 'editor.paste' &&
      array(field(span, 'attributes')).some(
        (attribute) =>
          field(attribute, 'key') === 'ui.operation' &&
          field(field(attribute, 'value'), 'stringValue') === 'editor.paste'
      )
  );
  expect(paste).toBeDefined();
  const attributes = array(field(paste, 'attributes'));
  expect(
    field(
      field(
        attributes.find(
          (attribute) =>
            field(attribute, 'key') === 'editor.long_task.supported'
        ),
        'value'
      ),
      'boolValue'
    )
  ).toBe(true);
  expect(
    Number(
      field(
        field(
          attributes.find(
            (attribute) => field(attribute, 'key') === 'editor.long_task.count'
          ),
          'value'
        ),
        'intValue'
      )
    )
  ).toBeGreaterThanOrEqual(1);
  expect(result.batches.join('')).not.toContain('Clipboard performance marker');
  await page.locator('#editor').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#editor')).not.toContainText(
    'Clipboard performance marker'
  );
  expect(await page.evaluate(() => window.editorPerformance.model())).toBe(
    before
  );
});
