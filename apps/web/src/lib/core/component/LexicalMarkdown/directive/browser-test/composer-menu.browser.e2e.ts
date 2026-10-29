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

async function formatMenuGap(page: Page, query: string) {
  await page.goto(`${fixture}?fixture=clipped-selection${query}`);
  const menu = page.getByTestId('format-menu');
  await expect.poll(() => menu.evaluate((el) => el.style.top)).toMatch(/px$/);
  const menuBox = await menu.boundingBox();
  const shell = await page.getByTestId('editor-shell').boundingBox();
  if (!menuBox || !shell) throw new Error('menu or editor not laid out');
  return menuBox.y - (shell.y + shell.height);
}

test('a format menu over a selection clipped by a scrolling editor stays beside the editor', async ({
  page,
}) => {
  const gap = await formatMenuGap(page, '');
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(16);
});

test('without clipping, the menu follows the hidden end of the selection', async ({
  page,
}) => {
  expect(await formatMenuGap(page, '&clip=0')).toBeGreaterThan(200);
});

test('a picker that focuses its search field stays visible above a bottom composer', async ({
  page,
}) => {
  await page.goto(`${fixture}?stealFocus=1`);
  await expect(page.getByTestId('search')).toBeFocused();
  const { menu, composer } = await boxes(page);

  expect(
    await page
      .getByTestId('menu')
      .evaluate((el) => getComputedStyle(el).visibility)
  ).toBe('visible');
  expect(menu.y + menu.height).toBeLessThanOrEqual(composer.y);
});
