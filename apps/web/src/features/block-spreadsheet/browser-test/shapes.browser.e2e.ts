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
    fileURLToPath(new URL('../core/xlsx-fixtures/shapes.xlsx', import.meta.url))
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Shapes', exact: true }).click();
});

test('shapes, text boxes, groups, SmartArt and an EMF logo are drawn', async ({
  page,
}) => {
  const notes = page.getByRole('figure', {
    name: 'Quarterly notes Revenue grew every month. See the chart.',
  });
  await expect(notes).toBeVisible();
  await expect(notes.getByText('Quarterly notes')).toHaveCSS(
    'font-weight',
    '700'
  );
  // Over its cells: columns E to H, rows 2 to 6.
  const box = await notes.boundingBox();
  const corner = await page.locator('[data-address="E2"]').boundingBox();
  expect(box?.x).toBeCloseTo(corner?.x ?? 0, 0);
  expect(box?.y).toBeCloseTo(corner?.y ?? 0, 0);

  await expect(
    page.getByRole('figure', { name: 'Total', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Order Ship' })).toBeVisible();
  await expect(
    page.getByRole('figure', { name: 'Plan Build Launch' })
  ).toBeVisible();
  // The arrow's line and head.
  const pointer = page.getByRole('figure', { name: 'Pointer' });
  await expect(pointer.locator('path')).toHaveCount(2);
  // The EMF is shown through a picture drawn of it.
  await expect(
    page.getByRole('figure', { name: 'Company logo' }).locator('img')
  ).toHaveAttribute('src', /^data:image\/png;base64,/);

  // A shape linked to a cell shows its value as it changes.
  const total = page.locator('[data-drawing="drawing-3"]');
  await expect(total).toHaveAccessibleName('4200');
  await expect(total.getByText('4200', { exact: true })).toBeVisible();
  await page.locator('[data-address="B2"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit B2', exact: true });
  await input.fill('2000');
  await input.press('Enter');
  await expect(total.getByText('5000', { exact: true })).toBeVisible();
  await expect(total).toHaveAccessibleName('5000');
});

test('shapes move with the keyboard and download as Excel wrote them', async ({
  page,
}) => {
  const button = page.getByRole('figure', { name: 'Total', exact: true });
  await button.click();
  await expect(button).toBeFocused();
  const before = (await button.boundingBox())!;
  await button.press('ArrowDown');
  await expect
    .poll(async () => (await button.boundingBox())!.y - before.y)
    .toBeCloseTo(8, 0);

  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const part = strFromU8(files['xl/drawings/drawing1.xml']);
  expect(part).toContain('textlink="$B$5"');
  expect(part).toContain('<a:t>Quarterly notes</a:t>');
  expect(part).toContain('prst="chevron"');
  // SmartArt downloads as a group of the shapes it drew.
  expect(part).toContain('<a:t>Launch</a:t>');
  // The moved button's anchor is 8 pixels lower: 76,200 EMU.
  expect(part).toMatch(
    /<xdr:row>7<\/xdr:row><xdr:rowOff>76200<\/xdr:rowOff>[\s\S]*?name="Total button"/
  );
  // The EMF itself is in the download.
  expect(Object.keys(files)).toContain('xl/media/image1.emf');
});
