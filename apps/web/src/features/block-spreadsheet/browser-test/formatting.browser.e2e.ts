import { expect, type Page, test } from '@playwright/test';

async function choose(page: Page, label: string, choice: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menuitem', { name: choice, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?mentions&hotkeys');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
});

test('formats a mixed whole column from ribbon menus without losing selection or scrolling to its bottom', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  const top = page.locator('[data-address="A1"]');
  const body = page.locator('[data-address="A2"]');
  await expect(top).toHaveCSS('font-weight', '600');
  await expect(body).toHaveCSS('font-weight', '400');
  await page
    .getByRole('button', { name: 'Select column A', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(body).toHaveCSS('font-weight', '600');
  await expect(top).toBeInViewport();

  await choose(page, 'Fill color', 'Fill color: Light yellow');
  await expect(body).toHaveCSS('background-color', 'rgb(255, 242, 204)');
  await choose(page, 'Text color', 'Text color: Charcoal');
  await expect(body).toHaveCSS('color', 'rgb(67, 67, 67)');
  await choose(page, 'Font family', 'Serif');
  await expect(body).toHaveCSS('font-family', /Georgia/);
  await choose(page, 'Borders', 'All borders');
  await expect(body).toHaveCSS('border-top-style', 'solid');
  await expect(body).toHaveCSS('border-left-style', 'solid');
  await expect(grid).toBeFocused();
  await expect(top).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Go to cell' })).toHaveValue(
    'A1:A200'
  );

  const saved = await page.evaluate(
    () => window.spreadsheetFixture.snapshot()[0].cells
  );
  for (const address of ['A1', 'A2', 'A200']) {
    expect(saved[address]).toMatchObject({
      bold: true,
      fontFamily: 'serif',
      fillColor: '#fff2cc',
      textColor: '#434343',
      borderTop: true,
      borderBottom: true,
      borderLeft: true,
      borderRight: true,
    });
  }
  await grid.press('ControlOrMeta+b');
  await expect(body).toHaveCSS('font-weight', '400');
  await expect(top).toBeInViewport();
});

test('treats direct typing and formula-bar edits as percentage points while preserving formula math', async ({
  page,
}) => {
  const cell = page.locator('[data-address="D2"]');
  await cell.click();
  await page
    .getByRole('button', { name: 'Format as percent', exact: true })
    .click();
  await page.getByRole('grid', { name: 'Spreadsheet' }).press('5');
  const editor = page.getByRole('textbox', { name: 'Edit D2', exact: true });
  await expect(editor).toHaveText('5');
  await editor.press('Enter');
  await expect(cell).toHaveText('5%');

  await cell.click();
  const formula = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });
  await formula.click();
  await formula.fill('7.5');
  await formula.press('Enter');
  await expect(cell).toHaveText('7.5%');
  await cell.dblclick();
  await expect(editor).toHaveText('7.5%');
  await editor.press('Enter');
  await expect(cell).toHaveText('7.5%');

  await page.locator('[data-address="E2"]').dblclick();
  const result = page.getByRole('textbox', { name: 'Edit E2', exact: true });
  await result.fill('=D2*1000');
  await result.press('Enter');
  await expect(page.locator('[data-address="E2"]')).toHaveText('75');
});

test('edits formula-bar text and formulas directly with the production mention editor enabled', async ({
  page,
}) => {
  await page.goto('/?mentions');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  const formula = page.getByRole('textbox', {
    name: 'Formula bar',
    exact: true,
  });

  await page.locator('[data-address="A2"]').click();
  await formula.click();
  await expect(formula).toBeFocused();
  await expect(formula).toHaveText('Design');
  await formula.press('End');
  await formula.pressSequentially(' team');
  await formula.press('Enter');
  await expect(page.locator('[data-address="A2"]')).toHaveText('Design team');

  await page.locator('[data-address="B4"]').click();
  await formula.click();
  await expect(formula).toBeFocused();
  await expect(formula).toHaveValue('=SUM(B2:B3)');
  await formula.press('End');
  await formula.pressSequentially('+5');
  await formula.press('Enter');
  await expect(page.locator('[data-address="B4"]')).toHaveText('35');

  await page.locator('[data-address="C2"]').click();
  await formula.click();
  // Typing '=' replaces the mention editor with the formula textarea. Focus
  // and the rest of the keystrokes must follow that replacement.
  await page.keyboard.type('=B2*3');
  await expect(formula).toBeFocused();
  await expect(formula).toHaveValue('=B2*3');
  await formula.press('Enter');
  await expect(page.locator('[data-address="C2"]')).toHaveText('30');
});

test('applies ribbon controls while the production cell editor has an uncommitted draft', async ({
  page,
}) => {
  await page.locator('[data-address="D2"]').click();
  await page.keyboard.type('Draft text');
  await choose(page, 'Fill color', 'Fill color: Light yellow');
  const cell = page.locator('[data-address="D2"]');
  await expect(cell).toHaveText('Draft text');
  await expect(cell).toHaveCSS('background-color', 'rgb(255, 242, 204)');
  await choose(page, 'Font family', 'Serif');
  await expect(cell).toHaveCSS('font-family', /Georgia/);
  await choose(page, 'Borders', 'All borders');
  await expect(cell).toHaveCSS('border-top-style', 'solid');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(cell).toHaveCSS('font-weight', '600');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
});
