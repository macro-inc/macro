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
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/chart-types.xlsx', import.meta.url)
    )
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
});

test('radar, bubble, stock and contour charts draw from their cells', async ({
  page,
}) => {
  await sheet(page, 'Ratings');
  const radar = page.getByRole('figure', { name: 'Chart: Product ratings' });
  // A ring of each product, with a marker at each of its five measures.
  await expect(radar.locator('path title')).toHaveText([
    'Basic',
    'Plus',
    'Pro',
  ]);
  await expect(radar.locator('circle')).toHaveCount(15);
  await expect(
    radar.locator('circle title', { hasText: 'Pro · Speed: 9' })
  ).toHaveCount(1);
  const filled = page.getByRole('figure', { name: 'Chart: Coverage' });
  await expect(filled.locator('path[fill-opacity], path[opacity]')).toHaveCount(
    2
  );

  await sheet(page, 'Stores');
  const stores = page.getByRole('figure', { name: 'Chart: Stores' });
  await expect(stores.locator('circle')).toHaveCount(4);
  const radius = async (tip: string) =>
    Number(
      await stores
        .locator('circle', { has: page.locator('title', { hasText: tip }) })
        .getAttribute('r')
    );
  // Areas follow the sizes: 1,600 square feet against 400.
  expect(
    (await radius('(210, 41), 1600')) / (await radius('(120, 35), 400'))
  ).toBeCloseTo(2, 1);

  await sheet(page, 'Prices');
  const prices = page.getByRole('figure', {
    name: 'Chart: Open, high, low, close',
  });
  await expect(prices.locator('path title')).toContainText([
    'Mar 4: high 108, low 100',
    'Mar 4: open 102, close 107',
  ]);
  await expect(
    prices.locator('path title', { hasText: /open .*, close / })
  ).toHaveCount(5);
  // A price edit redraws the day.
  await page.locator('[data-address="E2"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit E2', exact: true });
  await input.fill('101');
  await input.press('Enter');
  await expect(
    prices.locator('path title', { hasText: 'Mar 4: open 102, close 101' })
  ).toHaveCount(1);
  const closes = page.getByRole('figure', { name: 'Chart: High, low, close' });
  await expect(
    closes.locator('path title', { hasText: /^Close · / })
  ).toHaveCount(5);

  await sheet(page, 'Yield');
  const contour = page.getByRole('figure', { name: 'Chart: Yield' });
  await expect(contour.locator('rect title')).toHaveCount(12);
  // The legend names each band of values.
  await expect(
    contour.locator('svg text', { hasText: /^80–100$/ })
  ).toHaveCount(1);
});

test('more chart types are inserted from the Insert menu and downloaded', async ({
  page,
}) => {
  await sheet(page, 'Ratings');
  await page.locator('[data-address="B3"]').click();
  await page
    .getByRole('button', { name: 'Insert chart or image', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'More charts' }).click();
  await page
    .getByRole('menuitem', { name: 'Filled radar', exact: true })
    .click();
  const chart = page.getByRole('figure', { name: 'Chart: Chart 3' });
  await expect(chart).toBeFocused();
  await expect(chart.locator('path title')).toHaveText([
    'Basic',
    'Plus',
    'Pro',
  ]);

  // Three series make a high-low-close chart; two cannot.
  await chart.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit chart' });
  await dialog.getByLabel('Type').selectOption('stock');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(chart.locator('path title', { hasText: /, low / })).toHaveCount(
    5
  );
  await expect(chart).toBeFocused();
  await chart.press('Enter');
  await dialog.getByLabel('Data').fill('A1:C6');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'A stock chart needs three or four series: high, low and close, or open, high, low and close.'
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const parts = Object.entries(files)
    .filter(([name]) => name.startsWith('xl/charts/chart'))
    .map(([, bytes]) => strFromU8(bytes));
  // The six imported charts, and the one inserted as a stock chart.
  expect(parts).toHaveLength(7);
  expect(parts.filter((part) => part.includes('stockChart'))).toHaveLength(3);
  expect(parts.find((part) => part.includes('upDownBars'))).toBeTruthy();
  // Macro writes the chart it changed.
  expect(parts.find((part) => part.includes('<c:stockChart>'))).toContain(
    '<c:hiLowLines/>'
  );
  expect(parts.find((part) => part.includes('bubbleSize'))).toBeTruthy();
  expect(parts.find((part) => part.includes('surfaceChart'))).toBeTruthy();
  expect(
    parts.filter((part) => part.includes('<radarStyle val="filled"'))
  ).toHaveLength(1);
});

test('100% stacked columns and combo charts are inserted from the menu', async ({
  page,
}) => {
  await sheet(page, 'Ratings');
  await page.locator('[data-address="B3"]').click();
  await page
    .getByRole('button', { name: 'Insert chart or image', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: '100% stacked column', exact: true })
    .click();
  const stacked = page.getByRole('figure', { name: 'Chart: Chart 3' });
  await expect(stacked).toBeFocused();
  // Every category fills the axis, so the value labels run to 100%.
  await expect(stacked.locator('svg text', { hasText: /^100%$/ })).toHaveCount(
    1
  );
  await expect(
    stacked.locator('rect title', { hasText: 'Basic · Price:' })
  ).toHaveCount(1);

  await stacked.press('Escape');
  await page.locator('[data-address="B3"]').click();
  await page
    .getByRole('button', { name: 'Insert chart or image', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Column', exact: true }).click();
  const combo = page.getByRole('figure', { name: 'Chart: Chart 4' });
  await expect(combo).toBeFocused();
  await combo.press('Enter');
  const edit = page.getByRole('dialog', { name: 'Edit chart' });
  await edit.getByLabel('Type').selectOption('combo');
  await edit.getByRole('button', { name: 'Apply' }).click();
  await expect(combo).toBeFocused();
  // The last series is the line; the earlier series stay columns.
  await expect(
    combo.locator('rect title', { hasText: /^Basic · / })
  ).toHaveCount(5);
  await expect(
    combo.locator('rect title', { hasText: /^Plus · / })
  ).toHaveCount(5);
  await expect(combo.locator('path title', { hasText: /^Pro$/ })).toHaveCount(
    1
  );
  await expect(
    combo.locator('circle title', { hasText: /^Pro · / })
  ).toHaveCount(5);
});
