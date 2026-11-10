import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/selection-browser-test/fixture.html';
for (const engine of ['lexical', 'native']) {
  for (const kind of [
    'group-mention',
    'unknown-mention',
    'theme-mention',
    'connect-app',
  ]) {
    test(`${engine} actual ${kind} selection follows acknowledged model state`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/__macro_dev/gateway/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        return path.endsWith('/email/links')
          ? route.fulfill({ json: { links: [] } })
          : route.abort();
      });
      await page.goto(`${fixture}?engine=${engine}&kind=${kind}`);
      await expect
        .poll(() => page.evaluate(() => Boolean(window.fastSelectionFixture)))
        .toBe(true);
      const root = page.getByRole('textbox', {
        name: 'Fast decorator fixture',
      });
      await expect(root.locator('.bg-active')).toHaveCount(0);
      await page.evaluate(() => {
        const fixture = window.fastSelectionFixture;
        if (!fixture) throw new Error('Missing actual decorator fixture');
        fixture.selectDecorator();
      });
      await expect(root.locator('.bg-active')).toHaveCount(1);
      await page.evaluate(() => {
        const fixture = window.fastSelectionFixture;
        if (!fixture) throw new Error('Missing actual decorator fixture');
        fixture.clearSelection();
      });
      await expect(root.locator('.bg-active')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
