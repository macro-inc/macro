import { expect, type Locator, type Page, test } from '@playwright/test';

async function openField(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?operator-searchbar', { waitUntil: 'networkidle' });
  if (errors.length) throw new Error(errors.join('\n'));
  const field = page.getByRole('textbox', {
    name: 'Operator search',
    exact: true,
  });
  await field.click();
  await page.keyboard.type('type:');
  return field;
}

/** On screen: inside the viewport, and the topmost element at its center. */
async function expectOnScreen(page: Page, row: Locator) {
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('row has no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const hit = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x, y)?.closest('[role="option"]')?.textContent,
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(hit).toContain(await row.textContent());
}

test('shows the operator rows over a header that clips them, and a click picks one', async ({
  page,
}) => {
  await openField(page);
  const row = page.getByRole('option', { name: 'type:task' });
  await expectOnScreen(page, row);

  await row.click();
  await expect(page.getByTestId('operator-query')).toHaveText('type:task');
  await expect(page.getByTestId('opened-results')).toHaveText('0');
});

test('ArrowDown moves through rows that are on screen, and Enter picks one', async ({
  page,
}) => {
  await openField(page);
  await page.keyboard.press('ArrowDown');
  const active = page.getByRole('option', { selected: true });
  await expect(active).toHaveText('type:task');
  await expectOnScreen(page, active);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('operator-query')).toHaveText('type:task');
  await expect(page.getByTestId('opened-results')).toHaveText('0');
});

test('a plain word offers the filter it stands for, on screen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?operator-searchbar');
  if (errors.length) throw new Error(errors.join('\n'));
  const field = page.getByRole('textbox', { name: 'Operator search' });
  await field.click();
  await page.keyboard.type('budget tasks');
  const row = page.getByRole('option', { name: /Only tasks/ });
  await expectOnScreen(page, row);
  await row.click();
  await expect(page.getByTestId('operator-query')).toHaveText(
    'budget type:task'
  );
  await expect(page.getByTestId('opened-results')).toHaveText('0');
});

test('keeps the rows clickable inside the Cmd+K dialog', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?command-menu&eligible', { waitUntil: 'networkidle' });
  if (errors.length) throw new Error(errors.join('\n'));
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  await page
    .getByPlaceholder('Search...', { exact: true })
    .fill('search all recent messages from julia');
  const dialog = page.getByRole('dialog');
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  // The draft's filters are written into the field as operators.
  await expect(query).toHaveText('type:channel from:julia@macro.com');
  await query.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' type:');
  const row = page.getByRole('option', { name: 'type:task' });
  await expectOnScreen(page, row);

  await row.click();
  await expect(dialog).toBeVisible();
  await expect(query).toHaveText('type:channel from:julia@macro.com type:task');
});
