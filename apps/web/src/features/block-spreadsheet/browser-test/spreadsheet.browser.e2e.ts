import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';

async function menu(page: Page, name: string, item: string | RegExp) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function edit(page: Page, address: string, text: string) {
  await page.locator(`[data-address="${address}"]`).dblclick();
  const input = page.getByRole('textbox', {
    name: `Edit ${address}`,
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeVisible();
  // This value is produced by the real IronCalc worker, not fixture markup.
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
});

test('completes formulas and inserts a pointer-selected range without losing the editor', async ({
  page,
}) => {
  await page.locator('[data-address="C2"]').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit C2' });
  await input.fill('=SU');
  await expect(
    page.getByRole('listbox', { name: 'Formula suggestions' })
  ).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveValue('=SUM(');
  const from = await page.locator('[data-address="B2"]').boundingBox();
  const to = await page.locator('[data-address="B3"]').boundingBox();
  if (!from || !to) throw new Error('Range cells are not visible.');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('=SUM(B2:B3');
  await input.press(')');
  await input.press('Enter');
  await expect(page.locator('[data-address="C2"]')).toHaveText('30');
});

test('keeps function insertion, find, and paste menu focus usable from the ribbon', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.locator('[data-address="D2"]').click();
  await page.getByRole('button', { name: 'Functions', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'SUM Add values', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Edit D2' });
  await expect(input).toBeFocused();
  await input.fill('=SUM(B2:B3)');
  await input.press('Enter');
  await expect(page.locator('[data-address="D2"]')).toHaveText('30');

  await page
    .getByRole('button', { name: 'Find and replace', exact: true })
    .click();
  const find = page.getByRole('textbox', { name: 'Find in sheet' });
  await expect(find).toBeFocused();
  await find.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(grid).toBeFocused();

  await page
    .getByRole('button', { name: 'Paste special', exact: true })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Paste', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Paste values only', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(grid).toBeFocused();
});

test('menu dismissal preserves the outside input while actions and Escape return focus to the editor', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const address = page.getByRole('textbox', {
    name: 'Go to cell',
    exact: true,
  });
  const formula = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });

  for (const name of ['Number format', 'Format and data']) {
    await page.getByRole('button', { name, exact: true }).click();
    await address.click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(address).toBeFocused();
    await page.keyboard.type('C2');
    await address.press('Enter');
    await expect(address).toHaveValue('C2');

    await page.getByRole('button', { name, exact: true }).click();
    await formula.click();
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(formula).toBeFocused();
    await formula.fill('42');
    await formula.press('Enter');
    await expect(page.locator('[data-address="C2"]')).toHaveText('42');

    await page.getByRole('button', { name, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(grid).toBeFocused();
  }

  await menu(page, 'Number format', 'Currency $1,234.00');
  await expect(grid).toBeFocused();
  await expect(page.locator('[data-address="C2"]')).toHaveText('$42.00');
  await menu(page, 'Format and data', 'Clear formatting');
  await expect(grid).toBeFocused();
  await expect(page.locator('[data-address="C2"]')).toHaveText('42');
  await menu(page, 'Functions', 'SUM Add values');
  await expect(page.getByRole('textbox', { name: 'Edit C2' })).toBeFocused();
});

test('view options toggle display directly and return focus to the selected cell', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const formulaBar = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });
  const total = page.locator('[data-address="B4"]');
  await total.click();

  for (const name of ['Gridlines', 'Formula bar', 'Formulas']) {
    await page
      .getByRole('button', { name: 'View options', exact: true })
      .click();
    const option = page.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(option).toHaveAttribute(
      'aria-checked',
      name === 'Formulas' ? 'false' : 'true'
    );
    await option.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(grid).toBeFocused();
    await expect(total).toHaveAttribute('aria-selected', 'true');
  }
  await expect(total).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
  await expect(total).toHaveCSS('border-right-color', 'rgba(0, 0, 0, 0)');
  await expect(total).toHaveCSS('border-top-width', '0px');
  await expect(total).toHaveCSS('border-left-width', '0px');
  await expect(formulaBar).toBeHidden();
  await expect(total).toHaveText('=SUM(B2:B3)');

  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Formula bar', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(formulaBar).toBeVisible();
  await expect(formulaBar).toHaveValue('=SUM(B2:B3)');
  await expect(grid).toBeFocused();
});

test('creates and renames sheets, recalculates cross-sheet formulas, and protects viewer edits', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Sheet2', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Sheet actions for Sheet2' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Sheet name' });
  await expect(name).toBeFocused();
  await name.fill('Forecast');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(
    page.getByRole('tab', { name: 'Forecast', exact: true })
  ).toBeVisible();
  await edit(page, 'A1', '7');
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await edit(page, 'C2', '=Forecast!A1+B4');
  await expect(page.locator('[data-address="C2"]')).toHaveText('37');

  await page.evaluate(() => window.spreadsheetFixture.setReadonly(true));
  await expect(
    page.getByRole('button', { name: 'Add sheet', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Paste special', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Format and data', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Import and export', exact: true })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Import…', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('menuitem', {
      name: 'Download as Excel (.xlsx)',
      exact: true,
    })
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.locator('[data-address="C2"]').dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit C2' })).toBeHidden();
  await page.getByRole('tab', { name: 'Forecast', exact: true }).click();
  await expect(page.locator('[data-address="A1"]')).toHaveText('7');
});

test('focuses the new sheet for immediate typing after adding or duplicating it', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await expect(grid).toBeFocused();
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="A1"]')).toHaveText('42');

  await page.getByRole('button', { name: 'Sheet actions for Sheet2' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Sheet2 (2)', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(grid).toBeFocused();
  await page.keyboard.type('84');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="A1"]')).toHaveText('84');
  await page.getByRole('tab', { name: 'Sheet2', exact: true }).click();
  await expect(page.locator('[data-address="A1"]')).toHaveText('42');
});

test('returns keyboard navigation to the grid when cancelling address and font size edits', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const address = page.getByRole('textbox', {
    name: 'Go to cell',
    exact: true,
  });
  await address.fill('C10');
  await address.press('Escape');
  await expect(address).toHaveValue('A1');
  await expect(grid).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(address).toHaveValue('A2');

  const size = page.getByRole('spinbutton', { name: 'Font size', exact: true });
  await size.fill('24');
  await size.press('Escape');
  await expect(size).toHaveValue('10');
  await expect(grid).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(address).toHaveValue('A3');
  await size.focus();
  await size.press('Enter');
  await expect(grid).toBeFocused();
});

test('imports independent XLSX through the file picker and exports real formulas and cached results', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/openpyxl-reference.xlsx', import.meta.url)
    )
  );
  await expect(
    page.getByRole('dialog', { name: 'Import Excel workbook' })
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /Insert new sheets/ })
  ).toBeChecked();
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(
    page.getByRole('tab', { name: 'Overview', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-address="A1"]')).toHaveText('25');

  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('Spreadsheet fixture.xlsx');
  const path = await download.path();
  if (!path) throw new Error('The workbook download was not saved.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    'Sheet1',
    'Overview',
    "O'Brien Tax",
  ]);
  expect(workbook.getWorksheet('Sheet1')?.getCell('B4').value).toEqual({
    formula: 'SUM(B2:B3)',
    result: 30,
  });
  expect(workbook.getWorksheet('Overview')?.getCell('A1').value).toEqual({
    formula: "'O''Brien Tax'!A1*2",
    result: 25,
  });
});

test('undo restores the original workbook after replacing it with an Excel import', async ({
  page,
}) => {
  await edit(page, 'C2', 'Keep this work');
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/openpyxl-reference.xlsx', import.meta.url)
    )
  );
  await page.getByRole('radio', { name: /Replace workbook/ }).check();
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('[data-address="A1"]')).toHaveText('25');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(
    page.getByRole('tab', { name: 'Sheet1', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-address="C2"]')).toHaveText(
    'Keep this work'
  );
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('[data-address="A1"]')).toHaveText('25');
});

test('formatting keeps the grid mounted and quiet, and tabs restore a distant selection', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.locator('[data-address="B4"]').click();
  await grid.evaluate((element) => {
    element.setAttribute('data-original-grid', 'true');
    const statuses = Array.from(document.querySelectorAll('[role="status"]'));
    new MutationObserver(() => {
      if (
        statuses.some((status) => status.textContent?.includes('Calculating'))
      )
        element.setAttribute('data-calculation-flashed', 'true');
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page
    .getByRole('button', { name: 'Strikethrough', exact: true })
    .click();
  await expect(page.locator('[data-address="B4"]')).toHaveCSS(
    'text-decoration-line',
    'line-through'
  );
  // A negative assertion must cover the delayed calculation-status deadline.
  await page.waitForTimeout(350);
  await expect(grid).toHaveAttribute('data-original-grid', 'true');
  await expect(grid).not.toHaveAttribute('data-calculation-flashed');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');

  const address = page.getByRole('textbox', {
    name: 'Go to cell',
    exact: true,
  });
  await address.fill('Z180');
  await address.press('Enter');
  await expect(page.locator('[data-address="Z180"]')).toBeInViewport();
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await expect(page.locator('[data-address="A1"]')).toBeInViewport();
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await expect(address).toHaveValue('Z180');
  await expect(page.locator('[data-address="Z180"]')).toBeInViewport();
  await grid.press('ArrowUp');
  await expect(address).toHaveValue('Z179');
  await expect(page.locator('[data-address="Z179"]')).toBeInViewport();
});

test('a full workbook keeps sheet navigation and footer controls within a narrow panel', async ({
  page,
}) => {
  const workbook = new ExcelJS.Workbook();
  for (let index = 1; index <= 10; index++)
    workbook
      .addWorksheet(`Quarter ${index} detailed forecast`)
      .getCell('A1').value = index;
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles({
    name: 'Forecast.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await page.getByRole('radio', { name: /Replace workbook/ }).check();
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await expect(page.getByRole('tab')).toHaveCount(10);
  const first = page.getByRole('tab', {
    name: 'Quarter 1 detailed forecast',
    exact: true,
  });
  await first.press('End');
  const last = page.getByRole('tab', {
    name: 'Quarter 10 detailed forecast',
    exact: true,
  });
  await expect(last).toHaveAttribute('aria-selected', 'true');
  for (const width of [640, 360]) {
    await page.setViewportSize({ width, height: 600 });
    await last.press('End');
    await expect(last).toBeInViewport();
    await expect(
      page.getByRole('button', {
        name: 'Sheet actions for Quarter 10 detailed forecast',
      })
    ).toBeInViewport({ ratio: 0.95 });
    if (width < 640) {
      await page
        .getByRole('button', {
          name: 'Sheet actions for Quarter 10 detailed forecast',
        })
        .click();
      await expect(
        page.getByRole('menuitem', { name: 'Add 100 rows', exact: true })
      ).toBeInViewport({ ratio: 0.95 });
      await page.keyboard.press('Escape');
    } else {
      await expect(
        page.getByRole('button', { name: 'Add 100 rows', exact: true })
      ).toBeInViewport({ ratio: 0.95 });
    }
    const fileMenu = page.getByRole('button', {
      name: 'Import and export',
      exact: true,
    });
    await expect(fileMenu).toBeInViewport({ ratio: 0.95 });
    const bounds = await fileMenu.boundingBox();
    if (!bounds) throw new Error('Import and export button is not visible.');
    expect(bounds.width).toBeLessThanOrEqual(36);
    expect(bounds.height).toBeLessThanOrEqual(36);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(width - 16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(588);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
    await fileMenu.click();
    await expect(
      page.getByRole('menuitem', {
        name: 'Download as Excel (.xlsx)',
        exact: true,
      })
    ).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('[data-address="A1"]')).toHaveText('10');
});

test('ribbon formatting and data actions preserve the range, formulas, focus, and undo', async ({
  page,
}) => {
  const address = page.getByRole('textbox', {
    name: 'Go to cell',
    exact: true,
  });
  await address.fill('A2:B3');
  await address.press('Enter');
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(address).toHaveValue('A2:B3');
  await expect(page.locator('[data-address="A2"]')).toHaveCSS(
    'font-style',
    'italic'
  );
  await expect(page.locator('[data-address="B3"]')).toHaveCSS(
    'font-style',
    'italic'
  );
  await expect(page.locator('[data-address="A4"]')).toHaveCSS(
    'font-style',
    'normal'
  );

  await menu(page, 'Format and data', 'Sort selected range Z → A');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
  await expect(address).toHaveValue('A2:B3');
  await expect(page.locator('[data-address="A2"]')).toHaveText('Engineering');
  await expect(page.locator('[data-address="B2"]')).toHaveText('20');
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.spreadsheetFixture.snapshot()[0]))
          .cells
    )
    .toMatchObject({ A3: { value: 'Design' } });
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-address="A2"]')).toHaveText('Design');
  await expect(page.locator('[data-address="B2"]')).toHaveText('10');
  await expect(page.locator('[data-address="A2"]')).toHaveCSS(
    'font-style',
    'italic'
  );
  await menu(page, 'Format and data', 'Clear formatting');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
  await expect(address).toHaveValue('A2:B3');
  await expect(page.locator('[data-address="A2"]')).toHaveCSS(
    'font-style',
    'normal'
  );
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-address="A2"]')).toHaveCSS(
    'font-style',
    'italic'
  );
});

test('double-click renames tabs and right-click actions target the clicked sheet', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  const first = page.getByRole('tab', { name: 'Sheet1', exact: true });
  await first.dblclick();
  const name = page.getByRole('textbox', { name: 'Sheet name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Sheet1');
  await name.fill('Budget');
  await name.press('Enter');
  await expect(
    page.getByRole('tab', { name: 'Budget', exact: true })
  ).toBeVisible();

  const second = page.getByRole('tab', { name: 'Sheet2', exact: true });
  await second.click({ button: 'right' });
  await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText(
    'Sheet2'
  );
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Sheet2');
  await name.fill('Forecast');
  await name.press('Enter');
  await expect(
    page.getByRole('tab', { name: 'Forecast', exact: true })
  ).toBeVisible();

  await page
    .getByRole('tab', { name: 'Budget', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.evaluate(() => window.spreadsheetFixture.setReadonly(true));
  const budget = page.getByRole('tab', { name: 'Budget', exact: true });
  await budget.dblclick();
  await expect(page.getByRole('dialog')).toBeHidden();
  await budget.click({ button: 'right' });
  for (const label of ['Rename', 'Duplicate', 'Delete'])
    await expect(
      page.getByRole('menuitem', { name: label, exact: true })
    ).toBeDisabled();
});

test('imports, edits and exports an independent financial workbook using real workers', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'Import and export', 'Import…');
  await (await chooser).setFiles(
    fileURLToPath(
      new URL('../core/xlsx-fixtures/financial-model.xlsx', import.meta.url)
    )
  );
  await page.getByRole('button', { name: 'Import workbook' }).click();
  await page.getByRole('tab', { name: 'DCF model', exact: true }).click();
  await expect(page.locator('[data-address="B18"]')).toHaveText(
    '(1,250,000.13)'
  );
  await expect(page.locator('[data-address="B14"]')).toHaveText('25');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Gridlines', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-address="B18"]')).toHaveCSS(
    'border-bottom-style',
    'double'
  );
  await expect(page.locator('[data-address="B18"]')).toHaveCSS(
    'border-bottom-color',
    'rgb(18, 52, 86)'
  );
  await page.locator('[data-address="B18"]').dblclick();
  await page
    .getByRole('textbox', { name: 'Edit B18', exact: true })
    .fill('-2500000.125');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="B18"]')).toHaveText(
    '(2,500,000.13)'
  );
  const downloaded = page.waitForEvent('download');
  await menu(page, 'Import and export', 'Download as Excel (.xlsx)');
  const path = await (await downloaded).path();
  if (!path) throw new Error('Workbook download missing');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const model = workbook.getWorksheet('DCF model')!;
  expect(model.getCell('B18').value).toBe(-2500000.125);
  expect(model.getCell('B18').numFmt).toBe('#,##0.00;[Red](#,##0.00);"—"');
  expect(model.getCell('B18').border.bottom?.style).toBe('double');
  expect(model.getCell('B14').value).toEqual({
    formula: 'TaxRate*100',
    result: 25,
  });
  expect(model.getCell('A1').isMerged).toBe(true);
  expect(model.getRow(6).hidden).toBe(true);
  expect(model.views[0]).toMatchObject({
    state: 'frozen',
    xSplit: 1,
    ySplit: 3,
  });
});

test('row context menu inserts and deletes with formula updates and supports undo', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Select row 2', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Insert 1 row above', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.spreadsheetFixture.snapshot()[0]))
          .cells
    )
    .toMatchObject({ A3: { value: 'Design' } });
  await expect(page.locator('[data-address="B5"]')).toHaveText('30');
  const after = await page.evaluate(
    () => window.spreadsheetFixture.snapshot()[0]
  );
  expect(after.cells.B5.value).toBe('=SUM(B3:B4)');
  await page
    .getByRole('button', { name: 'Select row 3', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Delete 1 row', exact: true })
    .click();
  await expect(page.locator('[data-address="A3"]')).toHaveText('Engineering');
  await expect(page.locator('[data-address="B4"]')).toHaveText('20');
  await page.getByRole('grid').press('ControlOrMeta+z');
  await expect(page.locator('[data-address="A3"]')).toHaveText('Design');
  await expect(page.locator('[data-address="B5"]')).toHaveText('30');
});

test('column context menu hides, unhides and resizes without losing data', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Select column B', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Hide 1 column', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Select column B', exact: true })
  ).toHaveCount(0);
  await page.locator('[data-address="A2"]').click();
  await page.getByRole('grid').press('ArrowRight');
  await expect(page.locator('[data-address="C2"]')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page
    .getByRole('button', { name: 'Select column A', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Unhide all columns', exact: true })
    .click();
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page
    .getByRole('button', { name: 'Select column B', exact: true })
    .click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Resize 1 column…', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Size in pixels' }).fill('180');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-address="B2"]')).toHaveCSS('width', '180px');
});

test('header context menus respect view-only access', async ({ page }) => {
  await page.evaluate(() => window.spreadsheetFixture.setReadonly(true));
  await page
    .getByRole('button', { name: 'Select row 2', exact: true })
    .click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Copy', exact: true })
  ).not.toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByRole('menuitem', { name: 'Delete 1 row', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByRole('menuitem', { name: 'Insert 1 row above', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
});

test('cell mention editor retains focus, inserts atomic pills, and can switch to formulas', async ({
  page,
}) => {
  await page.goto('/?mentions');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.locator('[data-address="A6"]').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit A6', exact: true });
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Owner @tay');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Owner @tay');
  await page.getByRole('button', { name: 'Mention Taylor' }).click();
  await expect(editor).toBeFocused();
  await expect(editor.locator('[data-cell-mention]')).toHaveText('@Taylor');
  await editor.press('Enter');
  await expect(page.locator('[data-address="A6"]')).toHaveText(
    'Owner @Taylor '
  );
  await page.locator('[data-address="B6"]').dblclick();
  await page
    .getByRole('textbox', { name: 'Edit B6', exact: true })
    .pressSequentially('=SUM(B2:B3)');
  await expect(
    page.getByRole('textbox', { name: 'Edit B6', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="B6"]')).toHaveText('30');
});

test('mention editing switches back from formulas and leaves other inputs focusable', async ({
  page,
}) => {
  await page.goto('/?mentions');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await page.locator('[data-address="A6"]').dblclick();
  let editor = page.getByRole('textbox', { name: 'Edit A6', exact: true });
  await editor.pressSequentially('=');
  await editor.press('Backspace');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('**plain** @tay');
  await page.getByRole('button', { name: 'Mention Taylor' }).click();
  await editor.press('Enter');
  await expect(page.locator('[data-address="A6"]')).toHaveText(
    '**plain** @Taylor '
  );
  await page.getByRole('textbox', { name: 'Formula bar', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Formula bar', exact: true })
  ).toBeFocused();
});

test('header menu keyboard navigation keeps the targeted row selected', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Select row 4', exact: true })
    .click({ button: 'right' });
  await expect(
    page.getByRole('textbox', { name: 'Go to cell', includeHidden: true })
  ).toHaveValue('A4:Z4');
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('textbox', { name: 'Go to cell', includeHidden: true })
  ).toHaveValue('A4:Z4');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('textbox', { name: 'Go to cell', includeHidden: true })
  ).toHaveValue('A4:Z4');
});

test('cell context menu preserves ranges, edits the right cells and supports keyboard dismissal', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.locator('[data-address="B2"]').click();
  await page.locator('[data-address="B3"]').click({ modifiers: ['Shift'] });
  await page.locator('[data-address="B2"]').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Fill down', exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole('menuitem', { name: 'Fill right', exact: true })
  ).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Fill down', exact: true }).click();
  await expect(grid).toBeFocused();
  await expect(page.locator('[data-address="B3"]')).toHaveText('10');
  await expect(page.locator('[data-address="B4"]')).toHaveText('20');
  await page.locator('[data-address="A2"]').click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Clear values', exact: true })
    .click();
  await expect(page.locator('[data-address="A2"]')).toHaveText('');
  await expect(page.locator('[data-address="A3"]')).toHaveText('Engineering');
  await grid.press('Shift+F10');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(grid).toBeFocused();
  await page.locator('[data-address="B2"]').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit B2', exact: true });
  await editor.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(editor).toHaveValue('10');
});
