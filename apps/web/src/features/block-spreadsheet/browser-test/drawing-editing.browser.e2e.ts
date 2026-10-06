import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/** A 40-by-20 red PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJ0lEQVR4nGM8ISfHMBCAaUBsHbV41OJRi0ctHrV41OJRi0ctHhAAAF+MASwoT9QRAAAAAElFTkSuQmCC',
  'base64'
);

const drawings = async (page: Page) =>
  (await page.evaluate(() => window.spreadsheetFixture.snapshot()[0])).metadata
    ?.drawings ?? [];

async function insertChart(page: Page, type: string) {
  await page
    .getByRole('button', { name: 'Insert chart or image', exact: true })
    .click();
  await page.getByRole('menuitem', { name: type, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
});

test('a chart of the table around a cell is inserted beside it and edited', async ({
  page,
}) => {
  await page.locator('[data-address="B3"]').click();
  await insertChart(page, 'Column');
  const chart = page.getByRole('figure', { name: 'Chart: Amount' });
  await expect(chart).toBeFocused();
  // Design, Engineering and Total.
  await expect(chart.locator('rect title')).toHaveCount(3);
  expect(await drawings(page)).toMatchObject([
    {
      type: 'chart',
      from: { row: 0, column: 3 },
      width: 480,
      height: 288,
      chart: {
        references: [
          "'Sheet1'!$B$1",
          "'Sheet1'!$A$2:$A$4",
          "'Sheet1'!$B$2:$B$4",
        ],
      },
    },
  ]);

  // Arrows move it, Shift with an arrow sizes it.
  await chart.press('ArrowRight');
  await chart.press('Shift+ArrowDown');
  expect(await drawings(page)).toMatchObject([
    { from: { row: 0, column: 3, x: 8 }, height: 296 },
  ]);
  await expect(chart).toBeFocused();

  await chart.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit chart' });
  await dialog.getByLabel('Type').selectOption('line');
  await dialog.getByLabel('Title').fill('Amounts by item');
  await dialog.getByLabel('Legend').selectOption('bottom');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  const line = page.getByRole('figure', { name: 'Chart: Amounts by item' });
  await expect(line).toBeFocused();
  await expect(line.locator('circle')).toHaveCount(3);
  // The legend names the series.
  await expect(line.locator('svg text', { hasText: /^Amount$/ })).toHaveCount(
    1
  );

  // A range the dialog cannot chart keeps the dialog open.
  await line.press('Enter');
  await dialog.getByLabel('Data').fill('Z1');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Those cells have no values beside their names and labels.'
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(line).toBeFocused();

  // Undo returns the column chart.
  await line.press('Escape');
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await expect(grid).toBeFocused();
  await grid.press('ControlOrMeta+z');
  await expect(chart).toBeVisible();

  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Download as Excel (.xlsx)', exact: true })
    .click();
  const path = await (await downloaded).path();
  const files = unzipSync(new Uint8Array(readFileSync(path!)));
  const part = strFromU8(files['xl/charts/chart1.xml']);
  expect(part).toContain('<c:barChart><c:barDir val="col"/>');
  expect(part).toContain("<c:f>'Sheet1'!$B$2:$B$4</c:f>");
});

test('drawings move and size by dragging, and the keyboard reaches each', async ({
  page,
}) => {
  await page.locator('[data-address="A2"]').click();
  await insertChart(page, 'Pie');
  const chart = page.getByRole('figure', { name: 'Chart: Amount' });
  await expect(chart.locator('svg[role="img"] path')).toHaveCount(3);
  const before = (await chart.boundingBox())!;
  await page.mouse.move(before.x + 200, before.y + 150);
  await page.mouse.down();
  await page.mouse.move(before.x + 300, before.y + 230, { steps: 4 });
  await page.mouse.up();
  const moved = (await chart.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(100, 0);
  expect(moved.y - before.y).toBeCloseTo(80, 0);
  const handle = (await chart.locator('[data-handle="se"]').boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 30, { steps: 4 });
  await page.mouse.up();
  const sized = (await chart.boundingBox())!;
  expect(sized.width - moved.width).toBeCloseTo(55, 0);
  expect(sized.height - moved.height).toBeCloseTo(25, 0);

  // An image at the active cell, at its natural size.
  await page.locator('[data-address="A6"]').click();
  await page.getByLabel('Insert image file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const image = page.getByRole('figure', { name: 'logo' });
  await expect(image).toBeFocused();
  await expect(image.locator('img')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/
  );
  expect((await image.boundingBox())?.width).toBeCloseTo(40, 0);

  // Ctrl+Alt+5 selects the first drawing; Tab goes to the next.
  await image.press('Escape');
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await grid.press('Control+Alt+5');
  await expect(chart).toBeFocused();
  await chart.press('Tab');
  await expect(image).toBeFocused();
  await image.press('Shift+Tab');
  await expect(chart).toBeFocused();
  await chart.press('Delete');
  await expect(chart).toHaveCount(0);
  await expect(grid).toBeFocused();
  expect(await drawings(page)).toHaveLength(1);
});
