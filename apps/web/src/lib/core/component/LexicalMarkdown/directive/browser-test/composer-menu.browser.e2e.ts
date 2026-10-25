import { expect, type Page, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/directive/browser-test/composer-menu.html';

async function boxes(page: Page) {
  await expect(page.getByText('Row 12', { exact: true })).toBeAttached({
    timeout: 30_000,
  });
  const menu = await page.getByTestId('menu').boundingBox();
  const composer = await page.getByLabel('Composer').boundingBox();
  if (!menu || !composer) throw new Error('menu or composer not laid out');
  return { menu, composer };
}

test('a menu that opens short over a bottom composer goes above it at full height', async ({
  page,
}) => {
  await page.goto(fixture);
  const { menu, composer } = await boxes(page);

  expect(menu.y + menu.height).toBeLessThanOrEqual(composer.y);
  expect(menu.height).toBeGreaterThanOrEqual(256);
});

test('a menu under a composer near the top still opens below it', async ({
  page,
}) => {
  await page.goto(`${fixture}?caret=top`);
  const { menu, composer } = await boxes(page);

  expect(menu.y).toBeGreaterThanOrEqual(composer.y + composer.height);
  expect(menu.height).toBeGreaterThanOrEqual(256);
});
