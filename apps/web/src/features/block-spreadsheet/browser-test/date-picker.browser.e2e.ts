import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';

const cell = (page: Page, address: string) =>
  page.locator(`[data-address="${address}"]`);
const picker = (page: Page) => page.locator('[data-cell-date-picker]');
const pickerDay = (page: Page, state: 'active' | 'selected' | 'today') =>
  picker(page).locator(`[data-${state}]`);
const value = (page: Page, sheet: number, address: string) =>
  page.evaluate(
    ([index, key]) =>
      window.spreadsheetFixture.snapshot()[Number(index)].cells[key]?.value,
    [sheet, address]
  );

async function enter(page: Page, address: string, text: string) {
  await cell(page, address).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Due dates with a time, and a column that only accepts dates from 2026. */
async function scheduleWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Schedule');
  sheet.getRow(1).values = ['Due', 'Review'];
  sheet.getCell('A2').value = new Date(Date.UTC(2026, 9, 16, 9, 30));
  sheet.getCell('A2').numFmt = 'mmm d, yyyy h:mm';
  sheet.getCell('C2').value = { formula: 'A2+1' };
  sheet.getCell('C2').numFmt = 'm/d/yyyy';
  for (let row = 2; row <= 10; row++)
    sheet.getCell(`B${row}`).dataValidation = {
      type: 'date',
      operator: 'greaterThanOrEqual',
      allowBlank: true,
      formulae: [new Date(Date.UTC(2026, 0, 1))],
      showErrorMessage: true,
      error: 'Pick a date in 2026 or later.',
    };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 16, 12));
  await page.goto('/');
  await expect(cell(page, 'B4')).toHaveText('30');
});

test('a date cell opens a calendar below its editor; keys move and pick days', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  const editor = page.getByRole('textbox', { name: 'Edit C2', exact: true });
  // It opens even while the new date is still being calculated.
  await enter(page, 'C2', '10/16/2026');
  await cell(page, 'C2').dblclick();
  await expect(picker(page)).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(picker(page)).toContainText('October 2026');
  await expect(pickerDay(page, 'selected')).toHaveText('16');
  await expect(pickerDay(page, 'active')).toHaveText('16');
  // Like the dropdown list, the calendar sits beside the cell, not over it.
  const cellBox = await cell(page, 'C2').boundingBox();
  const pickerBox = await picker(page).boundingBox();
  expect(pickerBox!.y).toBeGreaterThanOrEqual(cellBox!.y + cellBox!.height);

  await page.keyboard.press('ArrowRight');
  await expect(pickerDay(page, 'active')).toHaveText('17');
  await page.keyboard.press('ArrowDown');
  await expect(pickerDay(page, 'active')).toHaveText('24');
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect(cell(page, 'C2')).toHaveText('10/24/2026');
  // A typed date is stored as its serial number shown as a date.
  expect(await value(page, 0, 'C2')).toBe('46319');
  await expect(address).toHaveValue('C3');
  await expect(grid).toBeFocused();

  // Escape closes the calendar first, then the editor, changing nothing.
  await cell(page, 'C2').click();
  await page.keyboard.press('Enter');
  await expect(pickerDay(page, 'active')).toHaveText('24');
  await page.keyboard.press('PageDown');
  await expect(picker(page)).toContainText('November 2026');
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(cell(page, 'C2')).toHaveText('10/24/2026');

  // A pressed day is written and the cell stays selected.
  await page.keyboard.press('Enter');
  await picker(page).getByRole('button', { name: 'Next month' }).click();
  await expect(picker(page)).toContainText('November 2026');
  await picker(page)
    .getByRole('gridcell', { name: '3', exact: true, disabled: false })
    .click();
  await expect(cell(page, 'C2')).toHaveText('11/3/2026');
  await expect(address).toHaveValue('C2');
  await expect(grid).toBeFocused();

  // Typing edits the raw value; arrows then move the caret, not days.
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(picker(page)).toBeHidden();
  await page.keyboard.type('7');
  await page.keyboard.press('ArrowLeft');
  await expect(editor).toHaveValue('11/3/2027');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C2')).toHaveText('11/3/2027');

  // Text and formulas have no calendar.
  await cell(page, 'A2').dblclick();
  await expect(
    page.getByRole('textbox', { name: 'Edit A2', exact: true })
  ).toBeFocused();
  await expect(picker(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await enter(page, 'D2', '=C2+1');
  await expect(cell(page, 'D2')).toHaveText('11/4/2027');
  await cell(page, 'D2').dblclick();
  await expect(
    page.getByRole('textbox', { name: 'Edit D2', exact: true })
  ).toBeFocused();
  await expect(picker(page)).toHaveCount(0);
});

test('a picked date is written the way the cell already stores it', async ({
  page,
}) => {
  await enter(page, 'C2', '2026-01-31');
  await expect(cell(page, 'C2')).toHaveText('2026-01-31');
  await cell(page, 'C2').click();
  await page.keyboard.press('Enter');
  // A month later than the 31st is the month's last day.
  await page.keyboard.press('PageDown');
  await expect(pickerDay(page, 'active')).toHaveText('28');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C2')).toHaveText('2026-02-28');
  expect(await value(page, 0, 'C2')).toBe('46081');

  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Import…', exact: true }).click();
  await (await chooser).setFiles({
    name: 'schedule.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await scheduleWorkbook(),
  });
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(cell(page, 'A2')).toHaveText('Oct 16, 2026 9:30');
  await expect(cell(page, 'C2')).toHaveText('10/17/2026');

  // A serial number keeps its time of day and its number format.
  await cell(page, 'A2').dblclick();
  await expect(pickerDay(page, 'selected')).toHaveText('16');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'A2')).toHaveText('Oct 17, 2026 9:30');
  expect(Number(await value(page, 1, 'A2'))).toBeCloseTo(46312.3958333, 6);
  await expect(cell(page, 'C2')).toHaveText('10/18/2026');
});

test('date validation opens the calendar on empty cells and checks the pick', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Import…', exact: true }).click();
  await (await chooser).setFiles({
    name: 'schedule.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await scheduleWorkbook(),
  });
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
  await expect(cell(page, 'A2')).toHaveText('Oct 16, 2026 9:30');

  // An empty cell starts at today, with no day selected.
  await cell(page, 'B3').dblclick();
  await expect(picker(page)).toContainText('October 2026');
  await expect(pickerDay(page, 'selected')).toHaveCount(0);
  await expect(pickerDay(page, 'active')).toHaveText('16');
  await expect(pickerDay(page, 'today')).toHaveText('16');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'B3')).toHaveText('10/16/2026');

  // A day the rule rejects is not written.
  await cell(page, 'B4').click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+PageUp');
  await expect(picker(page)).toContainText('October 2025');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'B4')).toHaveText('');
  await expect(page.getByText('Pick a date in 2026 or later.')).toBeVisible();

  // Cells outside the rule without a date keep a plain editor.
  await cell(page, 'D3').dblclick();
  await expect(
    page.getByRole('textbox', { name: 'Edit D3', exact: true })
  ).toBeFocused();
  await expect(picker(page)).toHaveCount(0);
});
