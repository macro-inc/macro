import { expect, type Locator, type Page, test } from '@playwright/test';

async function drag(page: Page, from: Locator, to: Locator) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Drag endpoints must be visible');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function edit(page: Page, address: string, value: string) {
  await page.locator(`[data-address="${address}"]`).dblclick();
  const input = page.getByRole('textbox', {
    name: `Edit ${address}`,
    exact: true,
  });
  await input.fill(value);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?hotkeys&mentions');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
});

test('selected cells own typing and arrow keys before app capture-phase shortcuts', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  await page.locator('[data-address="D2"]').click();
  await grid.press('h');
  const input = page.getByRole('textbox', { name: 'Edit D2', exact: true });
  await expect(input).toHaveText('h');
  await input.press('Enter');
  await expect(address).toHaveValue('D3');
  await grid.press('ArrowDown');
  await expect(address).toHaveValue('D4');
  await grid.press('ArrowRight');
  await expect(address).toHaveValue('E4');
  expect(
    await page.evaluate(() => window.spreadsheetFixture.globalShortcutCount())
  ).toBe(0);
  // The same shortcut remains active when the spreadsheet relinquishes focus.
  await page.getByRole('button', { name: 'Add sheet', exact: true }).focus();
  await page.keyboard.press('h');
  expect(
    await page.evaluate(() => window.spreadsheetFixture.globalShortcutCount())
  ).toBe(1);
});

test('selects multiple rows and columns by dragging and shift-clicking headers', async ({
  page,
}) => {
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  const header = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await drag(page, header('Select column B'), header('Select column D'));
  await expect(address).toHaveValue('B1:D200');
  await header('Select column F').click({ modifiers: ['Shift'] });
  await expect(address).toHaveValue('B1:F200');
  await page.getByRole('grid', { name: 'Spreadsheet' }).press('ArrowRight');
  await expect(address).toHaveValue('C1');
  await drag(page, header('Select row 3'), header('Select row 5'));
  await expect(address).toHaveValue('A3:Z5');
  await header('Select row 7').click({ modifiers: ['Shift'] });
  await expect(address).toHaveValue('A3:Z7');
  await page.getByRole('grid', { name: 'Spreadsheet' }).press('ArrowDown');
  await expect(address).toHaveValue('A4');
});

test('resizes row height with a pointer, saves it, and restores automatic height', async ({
  page,
}) => {
  const grip = page.getByRole('separator', {
    name: 'Resize row 2',
    exact: true,
  });
  const box = await grip.boundingBox();
  if (!box) throw new Error('Resize grip missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 50, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(grip).toHaveAttribute('aria-valuenow', '71');
  expect(
    await page.evaluate(
      () => window.spreadsheetFixture.snapshot()[0].metadata?.rowHeights?.[1]
    )
  ).toBe(53.25);
  await page.locator('[data-address="A2"]').click();
  await page.getByRole('grid', { name: 'Spreadsheet' }).press('ArrowDown');
  await expect(page.getByRole('textbox', { name: 'Go to cell' })).toHaveValue(
    'A3'
  );
  await grip.dblclick();
  await expect(grip).toHaveAttribute('aria-valuenow', '21');
  expect(
    await page.evaluate(
      () => window.spreadsheetFixture.snapshot()[0].metadata?.rowHeights?.[1]
    )
  ).toBeUndefined();
});

test('picks a range on a second sheet and commits the formula back to its original cell', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await edit(page, 'A1', '12');
  await edit(page, 'A2', '18');
  await page.getByRole('tab', { name: 'Sheet2', exact: true }).dblclick();
  await page.getByRole('textbox', { name: 'Sheet name' }).fill('Forecast 2027');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await page.locator('[data-address="C2"]').dblclick();
  await page
    .getByRole('textbox', { name: 'Edit C2', exact: true })
    .fill('=SUM(');
  await page.getByRole('tab', { name: 'Forecast 2027', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Formula bar', exact: true })
  ).toHaveValue('=SUM(');
  await drag(
    page,
    page.locator('[data-address="A1"]'),
    page.locator('[data-address="A2"]')
  );
  const formula = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });
  await expect(formula).toHaveValue("=SUM('Forecast 2027'!A1:A2");
  await expect(formula).toBeFocused();
  await formula.press(')');
  await formula.press('Enter');
  await expect(
    page.getByRole('tab', { name: 'Sheet1', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-address="C2"]')).toHaveText('30');
  const sheets = await page.evaluate(() =>
    window.spreadsheetFixture.snapshot()
  );
  expect(sheets[0].cells.C2.value).toBe("=SUM('Forecast 2027'!A1:A2)");
  expect(sheets[1].cells.A1.value).toBe('12');
});

test('drag fill continues numbers and month-end dates and undo restores the empty destination', async ({
  page,
}) => {
  for (let row = 1; row <= 4; row++) await edit(page, `D${row}`, String(row));
  await drag(
    page,
    page.locator('[data-address="D1"]'),
    page.locator('[data-address="D4"]')
  );
  await drag(
    page,
    page.getByRole('button', { name: 'Drag to fill selection' }),
    page.locator('[data-address="D8"]')
  );
  await expect(page.locator('[data-address="D8"]')).toHaveText('8');
  await page
    .getByRole('grid', { name: 'Spreadsheet' })
    .press('ControlOrMeta+z');
  await expect(page.locator('[data-address="D8"]')).toHaveText('');
  await edit(page, 'E1', '2026-01-31');
  await edit(page, 'E2', '2026-02-28');
  await drag(
    page,
    page.locator('[data-address="E1"]'),
    page.locator('[data-address="E2"]')
  );
  await drag(
    page,
    page.getByRole('button', { name: 'Drag to fill selection' }),
    page.locator('[data-address="E4"]')
  );
  const cells = await page.evaluate(
    () => window.spreadsheetFixture.snapshot()[0].cells
  );
  expect(cells.E3.value).toBe('2026-03-31');
  expect(cells.E4.value).toBe('2026-04-30');
});

test('types a spaced formula, picks another sheet by pointer, and returns to the source', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await edit(page, 'A1', '20');
  await page.getByRole('tab', { name: 'Sheet1', exact: true }).click();
  await page.locator('[data-address="C2"]').click();
  await page.keyboard.type('= b2 + ');
  await expect(
    page.getByRole('textbox', { name: 'Edit C2', exact: true })
  ).toHaveValue('= b2 + ');
  await page.getByRole('tab', { name: 'Sheet2', exact: true }).click();
  await page.locator('[data-address="A1"]').click();
  const formula = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });
  await expect(formula).toHaveValue("= b2 + 'Sheet2'!A1");
  await expect(formula).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('tab', { name: 'Sheet1', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-address="C2"]')).toHaveText('30');
  expect(
    await page.evaluate(
      () => window.spreadsheetFixture.snapshot()[0].cells.C2.value
    )
  ).toBe("= b2 + 'Sheet2'!A1");
  expect(
    await page.evaluate(() => window.spreadsheetFixture.globalShortcutCount())
  ).toBe(0);
});
