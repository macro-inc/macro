import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/block-database/browser-test/table-tabs.html', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
});

// When this fails, Tab on a selected cell switched the database's tables
// (or closed it) instead of moving to the next cell, or the table tabs lost
// their keys from the database pane itself.
test('Tab on a selected cell moves between cells and leaves the table open', async ({
  page,
}) => {
  const table = page.getByLabel('Table', { exact: true });
  const name = page.getByRole('button', { name: /^Name: First\./ });
  await name.click();
  await page.keyboard.press('Escape');
  await expect(name).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Edit Notes' })).toBeFocused();
  await expect(table).toHaveText('tasks');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Tab');
  await expect(table).toHaveText('tasks');
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
});

test('Tab and the number keys switch tables from the database pane', async ({
  page,
}) => {
  const table = page.getByLabel('Table', { exact: true });
  await page.locator('main').focus();

  await page.keyboard.press('Tab');
  await expect(table).toHaveText('people');
  await page.keyboard.press('Shift+Tab');
  await expect(table).toHaveText('tasks');
  await page.keyboard.press('2');
  await expect(table).toHaveText('people');
});

// When this fails, Tab or a number key with a range of cells selected (the
// grid itself has focus) switched the database's tables and dropped the
// selection.
test('a range of selected cells keeps its table', async ({ page }) => {
  const table = page.getByLabel('Table', { exact: true });
  const from = await page
    .getByRole('button', { name: /^Name: First\./ })
    .boundingBox();
  const to = await page
    .getByRole('button', { name: /^Notes: Second note\./ })
    .boundingBox();
  if (!from || !to) throw new Error('The cells are not on screen.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(table).toHaveText('tasks');
  await page.keyboard.press('2');
  await expect(table).toHaveText('tasks');
});
