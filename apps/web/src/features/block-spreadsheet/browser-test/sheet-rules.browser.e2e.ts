import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';

/** A tracker with conditional formatting, a validated status list and a note. */
async function trackerWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tracker');
  sheet.getRow(1).values = ['Status', 'Amount', 'Score'];
  ['Open', 'Done', 'Blocked', 'Open'].forEach((status, index) => {
    sheet.getRow(index + 2).values = [status, (index + 1) * 25, index * 30];
  });
  sheet.addConditionalFormatting({
    ref: 'A2:A5',
    rules: [
      {
        type: 'containsText',
        operator: 'containsText',
        text: 'Blocked',
        priority: 1,
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFFC7CE' },
          },
          font: { color: { argb: 'FF9C0006' } },
        },
      },
    ],
  });
  sheet.addConditionalFormatting({
    ref: 'B2:B5',
    rules: [
      {
        type: 'dataBar',
        priority: 2,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF638EC6' },
      } as ExcelJS.DataBarRuleType,
    ],
  });
  sheet.addConditionalFormatting({
    ref: 'C2:C5',
    rules: [
      {
        type: 'iconSet',
        priority: 3,
        iconSet: '3Arrows',
        cfvo: [
          { type: 'percent', value: 0 },
          { type: 'percent', value: 33 },
          { type: 'percent', value: 67 },
        ],
      },
    ],
  });
  for (let row = 2; row <= 20; row++)
    sheet.getCell(`A${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Open,Done,Blocked"'],
      showErrorMessage: true,
      errorTitle: 'Invalid status',
      error: 'Choose Open, Done or Blocked.',
      showInputMessage: true,
      promptTitle: 'Status',
      prompt: 'Pick from the list.',
    };
  sheet.getCell('B1').note = 'Amounts in USD';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importTracker(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Import…', exact: true }).click();
  await (await chooser).setFiles({
    name: 'tracker.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await trackerWorkbook(),
  });
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'Tracker', exact: true }).click();
  await expect(page.locator('[data-address="A4"]')).toHaveText('Blocked');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await importTracker(page);
});

test('imported conditional formatting draws fills, data bars and icons', async ({
  page,
}) => {
  const blocked = page.locator('[data-address="A4"]');
  await expect(blocked).toHaveCSS('background-color', 'rgb(255, 199, 206)');
  await expect(blocked).toHaveCSS('color', 'rgb(156, 0, 6)');
  await expect(page.locator('[data-address="A2"]')).not.toHaveCSS(
    'background-color',
    'rgb(255, 199, 206)'
  );
  // The largest amount fills its cell; the smallest has the shortest bar.
  const bar = (address: string) =>
    page
      .locator(`[data-address="${address}"] [data-data-bar]`)
      .evaluate((element) => element.getBoundingClientRect().width);
  expect(await bar('B5')).toBeGreaterThan(await bar('B2'));
  await expect(page.locator('[data-address="C5"] svg')).toBeVisible();

  // Editing a value re-evaluates its rules.
  await page.locator('[data-address="A2"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit A2', exact: true });
  await input.fill('Blocked');
  await input.press('Enter');
  await expect(page.locator('[data-address="A2"]')).toHaveCSS(
    'background-color',
    'rgb(255, 199, 206)'
  );
});

test('notes and input messages show beside the active cell', async ({
  page,
}) => {
  await expect(
    page.locator('[data-address="B1"] [data-note-marker]')
  ).toBeVisible();
  await page.locator('[data-address="B1"]').click();
  await expect(page.locator('[data-cell-note]')).toHaveText('Amounts in USD');
  await page.locator('[data-address="A3"]').click();
  await expect(page.locator('[data-cell-note]')).toHaveText(
    'StatusPick from the list.'
  );
});

test('list validation offers its choices and rejects other entries', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.locator('[data-address="A3"]').click();
  await expect(
    page.getByRole('button', { name: 'Choose a value for A3' })
  ).toBeVisible();
  await grid.press('Alt+ArrowDown');
  await expect(page.getByRole('menuitem')).toHaveText([
    'Open',
    'Done',
    'Blocked',
  ]);
  await page.getByRole('menuitem', { name: 'Blocked' }).click();
  await expect(page.locator('[data-address="A3"]')).toHaveText('Blocked');
  await expect(grid).toBeFocused();

  await page.locator('[data-address="A5"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit A5', exact: true });
  await input.fill('Maybe');
  await input.press('Enter');
  await expect(page.locator('[data-address="A5"]')).toHaveText('Open');
  await expect(
    page.getByText('Invalid status: Choose Open, Done or Blocked.')
  ).toBeVisible();
  // Matching ignores case, and clearing is always allowed.
  await page.locator('[data-address="A5"]').dblclick();
  await input.fill('done');
  await input.press('Enter');
  await expect(page.locator('[data-address="A5"]')).toHaveText('done');
});
