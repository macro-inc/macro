import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('GETPIVOTDATA reads an imported pivot table and follows its cells', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL(
        '../core/xlsx-fixtures/real-world/zenodo-ccs-cement-post-tax-dcf-model.xlsx',
        import.meta.url
      )
    )
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'RQ1', exact: true }).click();

  // Barge, South: the value the pivot table shows in J9, as Excel calculated.
  const lookup = page.locator('[data-address="K19"]');
  await expect(lookup).toHaveText('38.87');
  await page.locator('[data-address="J9"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit J9', exact: true });
  await input.fill('40');
  await input.press('Enter');
  await expect(lookup).toHaveText('40.00');

  // The download keeps the formula for Excel.
  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const sheets = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .map((name) => strFromU8(files[name]));
  expect(
    sheets.some((sheet) =>
      sheet.includes(
        '<f>GETPIVOTDATA(&quot;Transport Cost&quot;,$I$7,&quot;Mode of Transport&quot;,&quot;Barge&quot;,&quot;Sector Germany&quot;,&quot;South&quot;)</f><v>40</v>'
      )
    )
  ).toBe(true);
});

test('pivot tables over another workbook download with the data Excel saved', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL(
        '../core/xlsx-fixtures/real-world/figshare-ucl-social-enterprise-financial-sustainability-model.xlsx',
        import.meta.url
      )
    )
  );
  await expect(
    page.getByText(
      'Pivot tables over other workbooks or data connections show their last values in Macro; the download keeps them with the data Excel saved, to refresh in Excel.'
    )
  ).toBeVisible();
  // It has a Sheet1 of its own.
  await page.getByRole('radio', { name: /Replace workbook/ }).check();
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Charts_Labs', exact: true }).click();
  await expect(page.locator('[data-address="A10"]')).toHaveText('Grand Total');

  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const names = Object.keys(files);
  expect(
    names.filter((name) =>
      /^xl\/pivotCache\/pivotCacheRecords\d+\.xml$/.test(name)
    )
  ).toHaveLength(8);
  const links = names
    .filter((name) => name.startsWith('xl/pivotCache/_rels/'))
    .map((name) => strFromU8(files[name]));
  expect(links).toHaveLength(8);
  for (const link of links)
    expect(link).toContain(
      'Target="file:///E:\\MBA%20Project\\Interviews_Revenue_Model.xlsx" TargetMode="External"'
    );
  // The pivot charts stay pivot charts.
  expect(
    names.filter(
      (name) =>
        /^xl\/charts\/chart\d+\.xml$/.test(name) &&
        strFromU8(files[name]).includes('<c:pivotSource>')
    )
  ).toHaveLength(8);
});
