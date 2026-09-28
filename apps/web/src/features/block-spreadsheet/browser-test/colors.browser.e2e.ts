import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';

test('imported black text and borders follow the theme without changing exported colors', async ({
  page,
}) => {
  await page.goto('/?mentions&hotkeys');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const input = new ExcelJS.Workbook();
  const sheet = input.addWorksheet('Display colors');
  const black = sheet.getCell('A1');
  black.value = 'Imported heading';
  black.font = { color: { argb: 'FF000000' }, bold: true };
  black.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
  const filled = sheet.getCell('A2');
  filled.value = 'Intentional light fill';
  filled.font = { color: { argb: 'FF000000' } };
  filled.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' },
  };
  const header = sheet.getCell('A3');
  header.value = 'Intentional dark header';
  header.font = { color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF123456' },
  };
  const negative = sheet.getCell('A4');
  negative.value = -100;
  negative.font = { color: { argb: 'FFFF0000' } };

  await page.getByLabel('Import spreadsheet file').setInputFiles({
    name: 'display-colors.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await input.xlsx.writeBuffer()),
  });
  await page
    .getByRole('button', { name: 'Import workbook', exact: true })
    .click();
  await expect(page.locator('[data-address="A1"]')).toHaveText(
    'Imported heading'
  );
  const stored = await page.evaluate(() =>
    window.spreadsheetFixture.snapshot()
  );
  // Use explicit semantic tokens to exercise both palettes, independent of the
  // browser's preferred theme or the fixture's default palette.
  for (const [ink, surface] of [
    ['#ffffff', '#111111'],
    ['#000000', '#ffffff'],
  ]) {
    await page.locator('main').evaluate(
      (element, colors) => {
        element.style.setProperty('--color-ink', colors[0]);
        element.style.setProperty('--color-surface', colors[1]);
      },
      [ink, surface]
    );
    const expected = ink === '#ffffff' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
    await expect(page.locator('[data-address="A1"]')).toHaveCSS(
      'color',
      expected
    );
    await expect(page.locator('[data-address="A1"]')).toHaveCSS(
      'border-bottom-color',
      expected
    );
    await expect(page.locator('[data-address="A2"]')).toHaveCSS(
      'color',
      'rgb(0, 0, 0)'
    );
    await expect(page.locator('[data-address="A2"]')).toHaveCSS(
      'background-color',
      'rgb(255, 242, 204)'
    );
    await expect(page.locator('[data-address="A3"]')).toHaveCSS(
      'color',
      'rgb(255, 255, 255)'
    );
    await expect(page.locator('[data-address="A3"]')).toHaveCSS(
      'background-color',
      'rgb(18, 52, 86)'
    );
    await expect(page.locator('[data-address="A4"]')).toHaveCSS(
      'color',
      'rgb(255, 0, 0)'
    );
    expect(
      await page.evaluate(() => window.spreadsheetFixture.snapshot())
    ).toEqual(stored);
  }
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Download as Excel (.xlsx)', exact: true })
    .click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const output = new ExcelJS.Workbook();
  await output.xlsx.readFile(path);
  const exported = output.getWorksheet('Display colors')!;
  expect(exported.getCell('A1').font.color?.argb).toBe('FF000000');
  expect(exported.getCell('A1').border.bottom?.color?.argb).toBe('FF000000');
  expect(exported.getCell('A2').font.color?.argb).toBe('FF000000');
  expect(exported.getCell('A3').font.color?.argb).toBe('FFFFFFFF');
  expect(exported.getCell('A4').font.color?.argb).toBe('FFFF0000');
});
