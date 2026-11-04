import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const cell = (page: Page, address: string) =>
  page.locator(`[data-address="${address}"]`);
const box = (page: Page, address: string) =>
  page.getByRole('checkbox', { name: address, exact: true });
// Boxes sit in the middle of their cells; select beside them.
const edge = { position: { x: 4, y: 4 } };

async function enter(page: Page, address: string, value: string) {
  await cell(page, address).dblclick();
  const input = page.getByRole('textbox', {
    name: `Edit ${address}`,
    exact: true,
  });
  await input.fill(value);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'B4')).toHaveText('30');
});

test('checkboxes inserted from the menu toggle by click and Space and feed formulas', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await cell(page, 'C2').click(edge);
  await cell(page, 'C4').click({ modifiers: ['Shift'], ...edge });
  await page
    .getByRole('button', {
      name: 'Insert chart, image or checkbox',
      exact: true,
    })
    .click();
  await page.getByRole('menuitem', { name: 'Checkbox' }).click();
  await expect(grid).toBeFocused();
  for (const address of ['C2', 'C3', 'C4'])
    await expect(box(page, address)).toHaveAttribute('aria-checked', 'false');
  await expect(box(page, 'C5')).toHaveCount(0);

  await enter(page, 'D2', '=COUNTIF(C2:C4,TRUE)');
  await enter(page, 'D3', '=COUNTIF(C:C,FALSE)');
  await expect(cell(page, 'D2')).toHaveText('0');
  await expect(cell(page, 'D3')).toHaveText('3');

  // A click toggles only that box and selects its cell.
  await box(page, 'C3').click();
  await expect(box(page, 'C3')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Formula bar')).toHaveValue('TRUE');
  await expect(cell(page, 'D2')).toHaveText('1');
  await expect(grid).toBeFocused();

  // Shift+click on a box extends the selection without toggling it. Space
  // then checks the whole selection, and unchecks it once all are checked.
  await cell(page, 'C2').click(edge);
  await expect(box(page, 'C2')).toHaveAttribute('aria-checked', 'false');
  await box(page, 'C4').click({ modifiers: ['Shift'] });
  for (const address of ['C2', 'C3', 'C4'])
    await expect(cell(page, address)).toHaveAttribute('aria-selected', 'true');
  await expect(box(page, 'C4')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect(cell(page, 'D2')).toHaveText('3');
  await page.keyboard.press('Space');
  await expect(cell(page, 'D2')).toHaveText('0');
  await expect(cell(page, 'D3')).toHaveText('3');

  // Delete removes unchecked boxes; undo brings them back.
  await page.keyboard.press('Delete');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(cell(page, 'D3')).toHaveText('0');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(box(page, 'C2')).toHaveAttribute('aria-checked', 'false');

  // The cell menu removes boxes and keeps their values.
  await box(page, 'C2').click();
  await cell(page, 'C2').click({ button: 'right', ...edge });
  await page.getByRole('menuitem', { name: 'Remove checkbox' }).click();
  await expect(box(page, 'C2')).toHaveCount(0);
  await expect(cell(page, 'C2')).toHaveText('TRUE');
  await cell(page, 'C2').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert checkbox' }).click();
  await expect(box(page, 'C2')).toHaveAttribute('aria-checked', 'true');

  // Excel opens the download with its own checkbox format over booleans.
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Import and export' }).click();
  await page
    .getByRole('menuitem', { name: 'Download as Excel (.xlsx)' })
    .click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  expect(
    strFromU8(files['xl/featurePropertyBag/featurePropertyBag.xml'])
  ).toContain('<bag type="Checkbox"/>');
  expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toMatch(
    /<c r="C2" s="\d+" t="b"><v>1<\/v><\/c>/
  );

  // Viewers see the boxes but cannot toggle them.
  await page.evaluate(() => window.spreadsheetFixture.setReadonly(true));
  await box(page, 'C2').click({ force: true });
  await page.keyboard.press('Space');
  await expect(box(page, 'C2')).toHaveAttribute('aria-checked', 'true');
});
