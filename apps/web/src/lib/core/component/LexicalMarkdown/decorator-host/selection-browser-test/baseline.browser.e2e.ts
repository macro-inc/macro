import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/selection-browser-test/fixture.html';
const phase = process.env.FAST_DECORATOR_PHASE ?? 'before';
const baseline = process.env.FAST_DECORATOR_BASELINE;
if (!baseline)
  throw new Error(
    'FAST_DECORATOR_BASELINE must name the isolated OFF capture directory'
  );

for (const kind of [
  'group-mention',
  'unknown-mention',
  'theme-mention',
  'connect-app',
]) {
  test(`OFF literal ${kind} DOM and model`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__macro_dev/gateway/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return path.endsWith('/email/links')
        ? route.fulfill({ json: { links: [] } })
        : route.abort();
    });
    await page.goto(`${fixture}?kind=${kind}`);
    const root = page.getByRole('textbox', { name: 'Fast decorator fixture' });
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
    await expect
      .poll(() => page.evaluate(() => Boolean(window.fastSelectionFixture)))
      .toBe(true);
    const capture = await page.evaluate(() => {
      const actual = window.fastSelectionFixture;
      if (!actual) throw new Error('Missing actual Source fixture');
      return actual.snapshot();
    });
    expect(JSON.parse(capture.model).root.children.length).toBeGreaterThan(0);
    const file = resolve(baseline, `${info.project.name}-${kind}.json`);
    if (phase === 'before') {
      await mkdir(baseline, { recursive: true });
      await writeFile(file, JSON.stringify(capture));
    } else {
      expect(JSON.stringify(capture)).toBe(await readFile(file, 'utf8'));
    }
    await info.attach(`${phase}-${kind}.json`, {
      body: JSON.stringify(capture),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
