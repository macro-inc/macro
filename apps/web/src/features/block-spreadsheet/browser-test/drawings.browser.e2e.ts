import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/drawings.xlsx', import.meta.url)
    )
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Sales', exact: true }).click();
});

test('imported charts and images draw over their cells and follow edits', async ({
  page,
}) => {
  const chart = page.getByRole('figure', { name: 'Chart: Revenue and costs' });
  await expect(chart).toBeVisible();
  // Two series of six months.
  await expect(chart.locator('rect title')).toHaveCount(12);
  await expect(
    page.getByRole('figure', { name: 'Chart: Share by region' }).locator('path')
  ).toHaveCount(4);
  await expect(
    page.getByRole('figure', { name: 'Picture' }).locator('img')
  ).toHaveAttribute('src', /^data:image\/png;base64,/);
  // The chart sits over columns I to P, from row 2.
  const box = await chart.boundingBox();
  const corner = await page.locator('[data-address="I2"]').boundingBox();
  expect(box?.x).toBeCloseTo(corner?.x ?? 0, 0);
  expect(box?.y).toBeCloseTo(corner?.y ?? 0, 0);

  await page.locator('[data-address="B2"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit B2', exact: true });
  await input.fill('5000');
  await input.press('Enter');
  await expect(
    chart.locator('title', { hasText: 'Revenue · Jan: 5,000' })
  ).toHaveCount(1);
});

test('a selected drawing deletes with Delete and returns with undo', async ({
  page,
}) => {
  const chart = page.getByRole('figure', { name: 'Chart: Profit' });
  await chart.click();
  await expect(chart).toBeFocused();
  await chart.press('Delete');
  await expect(chart).toHaveCount(0);
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await expect(grid).toBeFocused();
  await grid.press('ControlOrMeta+z');
  await expect(chart).toBeVisible();
  // Escape returns to the cells without deleting.
  await chart.click();
  await chart.press('Escape');
  await expect(grid).toBeFocused();
  await expect(chart).toBeVisible();
});

test('downloads keep the charts and images', async ({ page }) => {
  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const charts = Object.keys(files).filter((name) =>
    name.startsWith('xl/charts/')
  );
  expect(charts).toHaveLength(8);
  expect(Object.keys(files)).toContain('xl/media/image1.png');
  const sales = Object.entries(files).find(
    ([name, bytes]) =>
      name.startsWith('xl/charts/') &&
      strFromU8(bytes).includes('<a:t>Revenue and costs</a:t>')
  );
  expect(sales && strFromU8(sales[1])).toContain(
    '<pt idx="5"><v>2250</v></pt>'
  );
});
