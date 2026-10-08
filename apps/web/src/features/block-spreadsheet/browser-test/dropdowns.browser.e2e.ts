import { expect, type Page, test } from '@playwright/test';

const cell = (page: Page, address: string) =>
  page.locator(`[data-address="${address}"]`);
const marker = (page: Page, address: string) =>
  cell(page, address).locator('[data-dropdown-marker]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'B4')).toHaveText('30');
});

test('a dropdown added from the menu shows arrows, offers its choices and rejects others', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await cell(page, 'C2').click();
  await cell(page, 'C5').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Format and data' }).click();
  await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dropdown' });
  await expect(dialog).toContainText('Cells C2:C5');
  await dialog
    .getByRole('textbox', { name: 'Choices, one per line' })
    .fill('Low\nMedium\nHigh');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(grid).toBeFocused();

  for (const address of ['C3', 'C4', 'C5'])
    await expect(marker(page, address)).toBeVisible();
  await expect(marker(page, 'C6')).toHaveCount(0);
  await expect(marker(page, 'D2')).toHaveCount(0);

  // The arrow of an inactive cell selects it and opens its choices.
  await marker(page, 'C4').click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Low',
    'Medium',
    'High',
  ]);
  await page.getByRole('menuitem', { name: 'High' }).click();
  await expect(cell(page, 'C4')).toHaveText('High');
  await expect(grid).toBeFocused();

  await cell(page, 'C3').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit C3', exact: true });
  await input.fill('Urgent');
  await input.press('Enter');
  await expect(cell(page, 'C3')).toHaveText('');
  await expect(
    page.getByText(
      "This value doesn't match the data validation restrictions defined for this cell."
    )
  ).toBeVisible();

  // The context menu reopens the rule to edit or remove it from the selection.
  const removeFromSelection = async () => {
    await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Choices, one per line' })
    ).toHaveValue('Low\nMedium\nHigh');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toBeHidden();
  };
  await cell(page, 'C5').click({ button: 'right' });
  await removeFromSelection();
  await expect(marker(page, 'C5')).toHaveCount(0);
  await expect(marker(page, 'C4')).toBeVisible();
  await cell(page, 'C2').click();
  await cell(page, 'C4').click({ modifiers: ['Shift'] });
  await cell(page, 'C3').click({ button: 'right' });
  await removeFromSelection();
  await expect(page.locator('[data-dropdown-marker]')).toHaveCount(0);
  await expect(cell(page, 'C4')).toHaveText('High');
});

test('a dropdown can list the values of a range and accept other entries', async ({
  page,
}) => {
  await cell(page, 'D2').click();
  await page.getByRole('button', { name: 'Format and data' }).click();
  await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dropdown' });
  await dialog.getByLabel('Use the values of a range').check();
  const range = dialog.getByRole('textbox', { name: 'Range of choices' });
  await range.fill('Missing!A1:A3');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'There is no sheet named “Missing”.'
  );
  await range.fill('A2:A4');
  await dialog.getByLabel('Reject values that are not a choice').uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Choose a value for D2' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'Design',
    'Engineering',
    'Total',
  ]);
  await page.getByRole('menuitem', { name: 'Engineering' }).click();
  await expect(cell(page, 'D2')).toHaveText('Engineering');

  await cell(page, 'D2').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit D2', exact: true });
  await input.fill('Marketing');
  await input.press('Enter');
  await expect(cell(page, 'D2')).toHaveText('Marketing');
});
