import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

const sheet = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true }).click();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/office-2016-charts.xlsx', import.meta.url)
    )
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await expect(
    page.getByRole('tab', { name: 'Share', exact: true })
  ).toBeVisible();
});

test("Excel 2016's charts and pie of pie draw from their cells", async ({
  page,
}) => {
  await sheet(page, 'Scores');
  const histogram = page.getByRole('figure', { name: 'Chart: Scores' });
  await expect(histogram.locator('rect title')).toHaveText([
    '[52, 62]: 3',
    '(62, 72]: 5',
    '(72, 82]: 3',
    '(82, 92]: 3',
    '(92, 102]: 1',
  ]);

  await sheet(page, 'Defects');
  const pareto = page.getByRole('figure', { name: 'Chart: Defects' });
  await expect(pareto.locator('rect title')).toHaveText([
    'Scratches: 40',
    'Chips: 30',
    'Cracks: 20',
    'Dents: 10',
    'Stains: 5',
  ]);
  await expect(pareto.locator('svg text', { hasText: /^100%$/ })).toHaveCount(
    1
  );

  await sheet(page, 'Cash');
  const waterfall = page.getByRole('figure', { name: 'Chart: Cash flow' });
  await expect(waterfall.locator('rect title')).toHaveText([
    'Start: 100',
    'Sales: 60',
    'Services: 20',
    'Costs: -50',
    'Tax: -15',
    'End: 115',
  ]);
  // A change in a cell moves every later bar and the total.
  await page.locator('[data-address="B5"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit B5', exact: true });
  await input.fill('-70');
  await input.press('Enter');
  await expect(
    waterfall.locator('rect title', { hasText: 'Costs: -70' })
  ).toHaveCount(1);

  await sheet(page, 'Pipeline');
  const funnel = page.getByRole('figure', { name: 'Chart: Pipeline' });
  await expect(funnel.locator('rect title')).toHaveText([
    'Visits: 1,000',
    'Leads: 400',
    'Trials: 150',
    'Sales: 60',
  ]);

  await sheet(page, 'Times');
  const box = page.getByRole('figure', { name: 'Chart: Delivery times' });
  await expect(box.locator('rect title')).toHaveText([
    'Minutes · East: Q1 14.25, median 15.5, Q3 18.75',
    'Minutes · West: Q1 21.5, median 24, Q3 27',
  ]);
  await expect(
    box.locator('circle title', { hasText: 'Minutes · East: 41' })
  ).toHaveCount(1);

  await sheet(page, 'Stores');
  const treemap = page.getByRole('figure', { name: 'Chart: Store sales' });
  await expect(
    treemap.locator('rect title', { hasText: 'North › Airport: 20' })
  ).toHaveCount(1);
  const sunburst = page.getByRole('figure', {
    name: 'Chart: Store sales by region',
  });
  await expect(sunburst.locator('path title')).toHaveText([
    'North: 50',
    'North › Downtown: 30',
    'North › Airport: 20',
    'South: 40',
    'South › Harbor: 25',
    'South › Mall: 15',
    'West: 10',
  ]);

  await sheet(page, 'Share');
  const pieOfPie = page.getByRole('figure', { name: 'Chart: Pie of pie' });
  await expect(pieOfPie.locator('path title')).toHaveText([
    'Desktop: 40%',
    'Phone: 30%',
    'Tablet: 12%',
    'Other: 18%',
    'Watch: 8%',
    'TV: 6%',
    'Other: 4%',
  ]);
  const barOfPie = page.getByRole('figure', { name: 'Chart: Bar of pie' });
  await expect(barOfPie.locator('rect title')).toHaveText([
    'Watch: 8%',
    'TV: 6%',
    'Other: 4%',
  ]);
});

test('a chart inserted as a waterfall becomes a funnel and downloads as chartEx', async ({
  page,
}) => {
  await sheet(page, 'Cash');
  await page.locator('[data-address="A3"]').click();
  await page
    .getByRole('button', {
      name: 'Insert chart, image or checkbox',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'More charts' }).click();
  await page.getByRole('menuitem', { name: 'Waterfall', exact: true }).click();
  const chart = page.getByRole('figure', { name: 'Chart: Amount' });
  await expect(chart).toBeFocused();
  await expect(chart.locator('rect title')).toHaveCount(6);
  // The legend names the colors.
  await expect(
    chart.locator('svg text', { hasText: /^Decrease$/ })
  ).toHaveCount(1);

  await chart.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit chart' });
  await dialog.getByLabel('Type').selectOption('funnel');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(
    chart.locator('rect title', { hasText: 'Start: 100' })
  ).toHaveCount(1);

  const downloaded = page.waitForEvent('download');
  await menu(page, 'Download', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const parts = Object.keys(files).filter((name) =>
    name.startsWith('xl/charts/chartEx')
  );
  // The seven imported, and the funnel Macro wrote.
  expect(parts).toHaveLength(8);
  const written = parts
    .map((name) => strFromU8(files[name]))
    .filter((part) => part.includes('layoutId="funnel"'));
  expect(written).toHaveLength(2);
  expect(strFromU8(files['xl/drawings/drawing3.xml'])).toContain(
    'Requires="cx2"'
  );
});
