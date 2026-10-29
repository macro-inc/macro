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
  const choice = (number: number) =>
    dialog.getByRole('textbox', { name: `Choice ${number}`, exact: true });
  await choice(1).fill('Low');
  await choice(1).press('Enter');
  await expect(choice(2)).toBeFocused();
  await choice(2).fill('Medium');
  await choice(2).press('Enter');
  await choice(3).fill('High');
  await choice(3).press('Enter');
  // Enter on the empty fourth choice saves.
  await choice(4).press('Enter');
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
      dialog.getByRole('textbox', { name: /^Choice \d+$/ })
    ).toHaveCount(3);
    for (const [index, value] of ['Low', 'Medium', 'High'].entries())
      await expect(choice(index + 1)).toHaveValue(value);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
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

test('dropdown choices show their colors in cells and in the open list', async ({
  page,
}) => {
  const chip = (address: string) =>
    cell(page, address).locator('[data-choice-chip]');
  await cell(page, 'E2').click();
  await cell(page, 'E4').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Format and data' }).click();
  await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dropdown' });
  await dialog
    .getByRole('textbox', { name: 'Choice 1', exact: true })
    .fill('Open');
  await dialog.getByRole('button', { name: 'Add choice' }).click();
  await dialog
    .getByRole('textbox', { name: 'Choice 2', exact: true })
    .fill('Done');
  await dialog.getByRole('button', { name: 'Color of Done' }).click();
  await page.getByRole('menuitem', { name: 'Green' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await marker(page, 'E3').click();
  const menu = page.getByRole('menu');
  await expect(
    menu.getByRole('menuitem', { name: 'Open' }).locator('[data-choice-chip]')
  ).toHaveCSS('background-color', 'rgb(191, 219, 254)');
  await expect(
    menu.getByRole('menuitem', { name: 'Done' }).locator('[data-choice-chip]')
  ).toHaveCSS('background-color', 'rgb(187, 247, 208)');
  await menu.getByRole('menuitem', { name: 'Done' }).click();
  await expect(chip('E3')).toHaveText('Done');
  await expect(chip('E3')).toHaveCSS('background-color', 'rgb(187, 247, 208)');

  // Typed values pick up their choice's color, ignoring case.
  await cell(page, 'E2').dblclick();
  const input = page.getByRole('textbox', { name: 'Edit E2', exact: true });
  await input.fill('open');
  await input.press('Enter');
  await expect(chip('E2')).toHaveCSS('background-color', 'rgb(191, 219, 254)');

  await cell(page, 'E3').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
  await dialog.getByRole('button', { name: 'Color of Done' }).click();
  await page.getByRole('menuitem', { name: 'No color' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip('E3')).toHaveCount(0);
  await expect(cell(page, 'E3')).toHaveText('Done');
  await expect(chip('E2')).toHaveText('open');
});

test('an open list stays beside its cell and moves to another dropdown cell in one click', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await cell(page, 'C2').click();
  await cell(page, 'E12').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Format and data' }).click();
  await page.getByRole('menuitem', { name: 'Dropdown…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dropdown' });
  const choice = (number: number) =>
    dialog.getByRole('textbox', { name: `Choice ${number}`, exact: true });
  await choice(1).fill('Low');
  await choice(1).press('Enter');
  await choice(2).fill('Medium');
  await choice(2).press('Enter');
  await choice(3).fill('High');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const list = page.getByRole('menu');
  await page.getByRole('button', { name: 'Choose a value for C2' }).click();
  await expect(list.getByRole('menuitem')).toHaveText([
    'Low',
    'Medium',
    'High',
  ]);
  const c2 = await cell(page, 'C2').boundingBox();
  const below = await list.boundingBox();
  expect(below!.y).toBeGreaterThanOrEqual(c2!.y + c2!.height);

  await cell(page, 'E2').click();
  await expect(cell(page, 'E2')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('button', { name: 'Choose a value for E2' })
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(list.getByRole('menuitem', { name: 'Low' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('menuitem', { name: 'Medium' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(cell(page, 'E2')).toHaveText('Medium');
  await expect(cell(page, 'C2')).toHaveText('');
  await expect(grid).toBeFocused();

  // Without room below, the list opens above the cell instead of over it.
  await page.setViewportSize({ width: 1440, height: 420 });
  await cell(page, 'D12').click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list).toBeVisible();
  const d12 = await cell(page, 'D12').boundingBox();
  const above = await list.boundingBox();
  expect(above!.y + above!.height).toBeLessThanOrEqual(d12!.y);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(grid).toBeFocused();
  await expect(cell(page, 'D12')).toHaveText('');
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
