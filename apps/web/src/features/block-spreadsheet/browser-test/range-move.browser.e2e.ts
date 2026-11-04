import { expect, type Page, test } from '@playwright/test';

/** Press a selection border beside a cell's center, ready to drag. */
async function grabBorder(
  page: Page,
  edge: 'top' | 'right' | 'bottom' | 'left',
  address: string
) {
  const border = await page
    .locator(`[data-selection-move="${edge}"]`)
    .boundingBox();
  const cell = await page.locator(`[data-address="${address}"]`).boundingBox();
  if (!border || !cell) throw new Error('Selection border must be visible');
  const vertical = edge === 'left' || edge === 'right';
  await page.mouse.move(
    vertical ? border.x + border.width / 2 : cell.x + cell.width / 2,
    vertical ? cell.y + cell.height / 2 : border.y + border.height / 2
  );
  await page.mouse.down();
}

async function moveTo(page: Page, address: string) {
  const cell = await page.locator(`[data-address="${address}"]`).boundingBox();
  if (!cell) throw new Error(`${address} must be visible`);
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, {
    steps: 8,
  });
}

const cells = (page: Page) =>
  page.evaluate(() => window.spreadsheetFixture.snapshot()[0].cells);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
});

test('drags a selection by its border and formulas follow the moved cells', async ({
  page,
}) => {
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  await page.locator('[data-address="B2"]').click();
  await page.locator('[data-address="B3"]').click({ modifiers: ['Shift'] });
  await expect(address).toHaveValue('B2:B3');
  await expect(page.locator('[data-selection-move="right"]')).toHaveCSS(
    'cursor',
    'move'
  );

  await grabBorder(page, 'left', 'B2');
  await moveTo(page, 'D6');
  await expect(page.locator('[data-move-destination]')).toHaveText('D6:D7');
  await page.mouse.up();

  await expect(page.locator('[data-address="D6"]')).toHaveText('10');
  await expect(page.locator('[data-address="D7"]')).toHaveText('20');
  await expect(page.locator('[data-address="B2"]')).toHaveText('');
  await expect(page.locator('[data-address="B4"]')).toHaveText('30');
  await expect(address).toHaveValue('D6:D7');
  await expect(page.locator('[data-move-destination]')).toHaveCount(0);
  expect((await cells(page)).B4.value).toBe('=SUM(D6:D7)');

  // One undo puts the cells and the formula back.
  await page
    .getByRole('grid', { name: 'Spreadsheet' })
    .press('ControlOrMeta+z');
  await expect(page.locator('[data-address="B2"]')).toHaveText('10');
  await expect(page.locator('[data-address="D6"]')).toHaveText('');
  expect((await cells(page)).B4.value).toBe('=SUM(B2:B3)');
});

test('asks before replacing values at the destination', async ({ page }) => {
  await page.locator('[data-address="A2"]').click();
  await grabBorder(page, 'bottom', 'A2');
  await moveTo(page, 'A3');
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Replace cells?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-address="A2"]')).toHaveText('Design');
  await expect(page.locator('[data-address="A3"]')).toHaveText('Engineering');

  await grabBorder(page, 'bottom', 'A2');
  await moveTo(page, 'A3');
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('[data-address="A3"]')).toHaveText('Design');
  await expect(page.locator('[data-address="A2"]')).toHaveText('');
  await expect(page.getByRole('grid', { name: 'Spreadsheet' })).toBeFocused();
});

test('scrolls the grid while dragging past its bottom edge', async ({
  page,
}) => {
  const grid = page.getByRole('grid', { name: 'Spreadsheet' });
  await page.locator('[data-address="A2"]').click();
  await grabBorder(page, 'bottom', 'A2');
  const box = await grid.boundingBox();
  if (!box) throw new Error('Grid must be visible');
  await page.mouse.move(box.x + 60, box.y + box.height + 30, { steps: 8 });
  await expect
    .poll(() => grid.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1_000);
  await page.mouse.up();
  await expect.poll(async () => (await cells(page)).A2).toBeUndefined();
  const moved = Object.entries(await cells(page)).find(
    ([, cell]) => cell.value === 'Design'
  );
  expect(moved?.[0]).toMatch(/^A\d+$/);
  expect(Number(moved?.[0].slice(1))).toBeGreaterThan(50);
  await expect(page.locator(`[data-address="${moved?.[0]}"]`)).toBeInViewport();
});

test('the border keeps clicks, double-clicks and the cell menu working', async ({
  page,
}) => {
  const address = page.getByRole('textbox', { name: 'Go to cell' });
  await page.locator('[data-address="B2"]').click();
  await page.locator('[data-address="B3"]').click({ modifiers: ['Shift'] });
  const border = await page
    .locator('[data-selection-move="bottom"]')
    .boundingBox();
  const b3 = await page.locator('[data-address="B3"]').boundingBox();
  if (!border || !b3) throw new Error('Selection border must be visible');
  const x = b3.x + b3.width / 2;
  const y = border.y + border.height / 2;
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Fill down', exact: true })
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(address).toHaveValue('B2:B3');
  await page.mouse.click(x, y);
  await expect(address).toHaveValue(/^B[34]$/);

  // A double-click on the edge of the selected cell still edits it.
  await page.locator('[data-address="C5"]').click();
  const c5 = await page.locator('[data-address="C5"]').boundingBox();
  if (!c5) throw new Error('C5 must be visible');
  await page.mouse.dblclick(c5.x + c5.width / 2, c5.y + 1);
  await expect(
    page.getByRole('textbox', { name: 'Edit C5', exact: true })
  ).toBeVisible();
});

test('Escape cancels a drag without moving cells', async ({ page }) => {
  await page.locator('[data-address="A3"]').click();
  await grabBorder(page, 'top', 'A3');
  await moveTo(page, 'D10');
  await expect(page.locator('[data-move-destination]')).toHaveText('D10');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-move-destination]')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('[data-address="A3"]')).toHaveText('Engineering');
  await expect(page.locator('[data-address="D10"]')).toHaveText('');
});
