import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/selection-browser-test/fixture.html';
const baseline = process.env.FAST_DECORATOR_BASELINE;
if (!baseline)
  throw new Error('Import proof requires frozen actual Source input');
for (const kind of [
  'group-mention',
  'unknown-mention',
  'theme-mention',
  'connect-app',
]) {
  test(`import-matched actual ${kind} DOM and JSON`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__macro_dev/gateway/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return path.endsWith('/email/links')
        ? route.fulfill({ json: { links: [] } })
        : route.abort();
    });
    const saved: unknown = JSON.parse(
      await readFile(
        resolve(baseline, `${info.project.name}-${kind}.json`),
        'utf8'
      )
    );
    const input: unknown =
      typeof saved === 'object' && saved !== null
        ? Reflect.get(saved, 'model')
        : undefined;
    if (typeof input !== 'string')
      throw new Error('Frozen Source input is malformed');
    await page.addInitScript((value) => {
      window.fastSelectionInput = value;
    }, input);
    const captures = [];
    for (const engine of ['lexical', 'native']) {
      await page.goto(`${fixture}?engine=${engine}&trace=import&kind=${kind}`);
      const root = page.getByRole('textbox', {
        name: 'Fast decorator fixture',
      });
      await expect
        .poll(() => page.evaluate(() => Boolean(window.fastSelectionFixture)))
        .toBe(true);
      if (kind === 'watermark')
        await expect(root.locator('[data-watermark]')).toHaveText(
          'Fixture watermark'
        );
      else if (kind === 'await')
        await expect(
          root.locator(
            '[data-await-id="fixture-await"]:not([data-lexical-decorator])'
          )
        ).toHaveText('Waiting for fixture');
      else if (kind === 'html-render')
        await expect(
          root.locator('[data-html-render]:not([data-lexical-decorator])')
        ).toHaveText('Fixture email content');
      else if (kind === 'group-mention')
        await expect(
          root.getByText('@fixture-group', { exact: true })
        ).toBeVisible();
      else if (kind === 'unknown-mention')
        await expect(
          root.getByText('Fixture unknown', { exact: true })
        ).toBeVisible();
      else if (kind === 'theme-mention')
        await expect(
          root.getByText('Fixture theme', { exact: true })
        ).toBeVisible();
      else if (kind === 'connect-app')
        await expect(
          root.getByRole('button', { name: 'Connect Cursor', exact: true })
        ).toBeVisible();
      else await expect(root.locator('div[hidden]')).toHaveCount(1);
      const actual = await page.evaluate(() => {
        const fixture = window.fastSelectionFixture;
        if (!fixture) throw new Error('Missing real imported fixture');
        return { capture: fixture.snapshot(), trace: fixture.trace() };
      });
      expect(actual.trace).toEqual({
        mode: 'import',
        beforeImportDecorators: 0,
        firstObservation: 'after-import',
      });
      captures.push(actual.capture);
      await info.attach(`${engine}-import-${kind}.json`, {
        body: JSON.stringify(actual),
        contentType: 'application/json',
      });
    }
    expect(JSON.stringify(captures[1])).toBe(JSON.stringify(captures[0]));
    expect(errors).toEqual([]);
  });
}
