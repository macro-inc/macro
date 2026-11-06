import { expect, type Page, test } from '@playwright/test';

const cell = (page: Page, address: string) =>
  page.locator(`[data-address="${address}"]`);

async function type(page: Page, address: string, value: string) {
  await cell(page, address).dblclick();
  const input = page.getByRole('textbox', {
    name: `Edit ${address}`,
    exact: true,
  });
  await input.fill(value);
  await input.press('Enter');
}

async function formula(page: Page, address: string) {
  await cell(page, address).click();
  return page.getByRole('textbox', { name: 'Formula bar' });
}

const tableMenu = (page: Page, name: string) =>
  page.getByRole('button', { name: `Table ${name} menu` });

/** A table's name shows while the pointer is on the table. */
async function openTableMenu(page: Page, name: string) {
  await cell(page, 'A3').hover();
  await tableMenu(page, name).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'B4')).toHaveText('30');
});

test('a block converts to a table with Google Sheets features', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  // The seeded total line would block a footer row below the table.
  await cell(page, 'A4').click();
  await cell(page, 'B4').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');

  // One cell converts the block of filled cells around it, with no dialog.
  await cell(page, 'A2').click();
  await page.getByRole('button', { name: 'Format and data' }).click();
  await page.getByRole('menuitem', { name: 'Convert to table' }).click();
  await expect(tableMenu(page, 'Table1')).toBeVisible();
  await expect(grid).toBeFocused();

  await tableMenu(page, 'Table1').click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Footer row with totals' })
    .click();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'A4')).toHaveText('Total');
  await expect(cell(page, 'B4')).toContainText('30');

  await type(page, 'D6', '=SUBTOTAL(109,Table1[Amount])');
  await type(page, 'D7', '=SUM(Table1[Amount])');
  await type(page, 'D8', '=SUBTOTAL(9,Table1)');
  await expect(cell(page, 'D8')).toHaveText('30');

  // Filtering by values hides rows; SUBTOTAL leaves them out and SUM keeps them.
  await page.getByRole('button', { name: 'Item column menu' }).click();
  await page.getByRole('menuitem', { name: 'Filter…' }).click();
  const filter = page.getByRole('dialog', { name: 'Filter “Item”' });
  const design = filter.getByRole('checkbox', { name: 'Design' });
  await expect(design).toBeChecked();
  await filter.getByText('Design', { exact: true }).click();
  await expect(design).not.toBeChecked();
  await filter.getByRole('button', { name: 'OK' }).click();
  await expect(filter).toBeHidden();
  await expect(cell(page, 'A2')).toHaveCount(0);
  await expect(cell(page, 'D6')).toHaveText('20');
  await expect(cell(page, 'D7')).toHaveText('30');
  await expect(cell(page, 'D8')).toHaveText('20');
  await page
    .getByRole('button', { name: 'Item column menu, filtered' })
    .click();
  await page.getByRole('menuitem', { name: 'Clear filter' }).click();
  await expect(cell(page, 'A2')).toHaveText('Design');

  // Filtering by condition.
  await page.getByRole('button', { name: 'Amount column menu' }).click();
  await page.getByRole('menuitem', { name: 'Filter…' }).click();
  const amount = page.getByRole('dialog', { name: 'Filter “Amount”' });
  await amount.getByRole('button', { name: 'Condition' }).click();
  await page.getByRole('option', { name: 'Greater than', exact: true }).click();
  await amount.getByRole('textbox', { name: 'Value' }).fill('15');
  await amount.getByRole('button', { name: 'OK' }).click();
  await expect(cell(page, 'A2')).toHaveCount(0);
  await expect(cell(page, 'D6')).toHaveText('20');
  await openTableMenu(page, 'Table1');
  await page.getByRole('menuitem', { name: 'Clear all filters' }).click();
  await expect(cell(page, 'A2')).toHaveText('Design');

  await page.getByRole('button', { name: 'Amount column menu' }).click();
  await page.getByRole('menuitem', { name: 'Sort Z → A' }).click();
  await expect(cell(page, 'A2')).toHaveText('Engineering');
  await expect(cell(page, 'A3')).toHaveText('Design');

  // The footer's cells choose their aggregate and name it.
  await cell(page, 'B4').click();
  await page.getByRole('button', { name: 'Choose a value for B4' }).click();
  await page.getByRole('menuitem', { name: 'Average' }).click();
  await expect(cell(page, 'B4')).toContainText('15');
  await expect(cell(page, 'B4').locator('[data-total-label]')).toHaveText(
    'Average'
  );

  // A column type formats the column and flags values that do not fit.
  await page.getByRole('button', { name: 'Amount column menu' }).click();
  await page.getByRole('menuitem', { name: 'Column type' }).click();
  await page.getByRole('menuitemradio', { name: 'Currency' }).click();
  await expect(cell(page, 'B2')).toHaveText('$20.00');
  await type(page, 'B3', 'unknown');
  await expect(cell(page, 'B3').locator('[data-type-mismatch]')).toHaveCount(1);
  await expect(cell(page, 'B3')).toHaveAttribute('title', 'Expected a number');
  await type(page, 'B3', '10');
  await expect(cell(page, 'B3').locator('[data-type-mismatch]')).toHaveCount(0);

  // Typing right of the table adds a named column.
  await type(page, 'C2', 'yes');
  await expect(cell(page, 'C1')).toHaveText('Column3');
  await expect(
    page.getByRole('button', { name: 'Column3 column menu' })
  ).toBeVisible();

  // Renaming a header renames the formulas that use it.
  await type(page, 'B1', 'Cost');
  await expect(await formula(page, 'D7')).toHaveValue('=SUM(Table1[Cost])');
  await expect(cell(page, 'D7')).toHaveText('30');

  // Formulas complete table names and columns.
  await cell(page, 'D9').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit D9', exact: true });
  await editor.pressSequentially('=SUM(Table1[C');
  await expect(
    page.getByRole('option', { name: /^Cost\b/ }).first()
  ).toBeVisible();
  await editor.press('Enter');
  await expect(editor).toHaveValue('=SUM(Table1[Cost]');
  await editor.press('Escape');

  // The table's menu renames it, its formulas following.
  await openTableMenu(page, 'Table1');
  await page.getByRole('menuitem', { name: 'Rename table' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename table' });
  await rename.getByRole('textbox', { name: 'Table name' }).fill('Q1 budget');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(rename).toBeHidden();
  await expect(await formula(page, 'D7')).toHaveValue('=SUM(Q1_budget[Cost])');

  await openTableMenu(page, 'Q1_budget');
  await page.getByRole('radio', { name: 'Red' }).click();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'A1')).toHaveCSS(
    'background-color',
    'rgb(217, 48, 37)'
  );

  // The group by view summarizes groups and filters to one.
  await openTableMenu(page, 'Q1_budget');
  await page.getByRole('menuitem', { name: 'Group by view…' }).click();
  const groups = page.getByRole('dialog', { name: /Group by view/ });
  await expect(groups.getByRole('row')).toHaveCount(4);
  await groups.getByRole('button', { name: 'Design' }).click();
  await expect(cell(page, 'A2')).toHaveCount(0);
  await groups.getByRole('button', { name: 'Show all rows' }).click();
  await groups.getByRole('button', { name: 'Close' }).click();
  await expect(cell(page, 'A2')).toHaveText('Engineering');

  // Converting to a range keeps the look and the results, with cell ranges.
  await openTableMenu(page, 'Q1_budget');
  await page.getByRole('menuitem', { name: 'Convert to range' }).click();
  await expect(tableMenu(page, 'Q1_budget')).toHaveCount(0);
  await expect(await formula(page, 'D7')).toHaveValue('=SUM($B$2:$B$3)');
  await expect(cell(page, 'A1')).toHaveCSS(
    'background-color',
    'rgb(217, 48, 37)'
  );

  // ⌘/Ctrl+Alt+T converts again; deleting the table removes its cells.
  await cell(page, 'A2').click();
  await page.keyboard.press('Control+Alt+t');
  await expect(tableMenu(page, 'Table1')).toBeVisible();
  await tableMenu(page, 'Table1').click();
  await page.getByRole('menuitem', { name: 'Delete table' }).click();
  await expect(tableMenu(page, 'Table1')).toHaveCount(0);
  await expect(cell(page, 'A2')).toHaveText('');
});
