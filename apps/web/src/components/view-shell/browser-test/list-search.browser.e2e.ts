import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/list-search.html';

// The same keys hold in a list header and in a sidebar that is the list.
const SURFACES = ['', '?surface=sidebar'];

async function open(page: Page, query = '') {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(fixture + query, { waitUntil: 'networkidle' });
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));

  await page.getByRole('button', { name: 'Search files' }).click();
  const field = page.getByRole('searchbox', { name: 'Search files' });
  await expect(field).toBeFocused();
  return {
    field,
    grid: page.getByRole('grid', { name: 'Files' }),
    rows: page.getByRole('row'),
  };
}

for (const surface of SURFACES) {
  test(`moves from the search field into the results and back out${surface}`, async ({
    page,
  }) => {
    const { field, grid, rows } = await open(page, surface);

    await field.pressSequentially('budget');
    await expect(rows).toHaveCount(3);

    await page.keyboard.press('ArrowDown');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveAttribute('aria-activedescendant', 'Budget 2026');

    await page.keyboard.press('j');
    await page.keyboard.press('ArrowDown');
    await expect(grid).toHaveAttribute(
      'aria-activedescendant',
      'Launch budget'
    );
    await expect(field).toHaveValue('budget');

    await field.focus();
    await page.keyboard.press('Enter');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveAttribute('aria-activedescendant', 'Budget 2026');

    // Escape leaves the list on the row it was on.
    await page.keyboard.press('j');
    await field.focus();
    await page.keyboard.press('Escape');
    await expect(grid).toBeFocused();
    await expect(grid).toHaveAttribute('aria-activedescendant', 'Budget notes');
  });

  test(`keeps the search on Escape in the field and clears it from the list${surface}`, async ({
    page,
  }) => {
    const { field, grid, rows } = await open(page, surface);
    await field.pressSequentially('budget');

    await page.keyboard.press('Escape');
    await expect(grid).toBeFocused();
    await expect(field).toHaveValue('budget');
    await expect(rows).toHaveCount(3);

    // A sidebar's field stays beside the detail, whose Escape it leaves alone.
    if (surface) {
      await page.getByRole('button', { name: 'Open detail' }).focus();
      await page.keyboard.press('Escape');
      await expect(field).toHaveValue('budget');
      await grid.focus();
    }

    // A selection is the innermost level, then the search, then the tab.
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect(page.getByRole('row', { selected: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row', { selected: true })).toHaveCount(0);
    await expect(field).toHaveValue('budget');

    await page.keyboard.press('Escape');
    await expect(rows).toHaveCount(5);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByTestId('tab')).toHaveText('Archived');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tab')).toHaveText('Inbox');
  });
}

test('a wide field owns the header and runs a recent search from the keyboard', async ({
  page,
}) => {
  const { field, grid, rows } = await open(page, '?wide');
  const header = await page.getByRole('heading').boundingBox();
  const box = await field.boundingBox();

  // The other header actions make room for the field while it is open.
  await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0);
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.y).toBeLessThan(header!.y + header!.height);

  const recent = page.getByRole('option');
  await expect(recent).toHaveText(['budget', 'roadmap']);
  await field.pressSequentially('bu');
  await expect(recent).toHaveText(['budget']);

  await page.keyboard.press('ArrowDown');
  await expect(field).toBeFocused();
  await expect(page.getByRole('option', { selected: true })).toHaveText(
    'budget'
  );

  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('budget');
  await expect(rows).toHaveCount(3);
  await expect(grid).toBeFocused();
  await expect(grid).toHaveAttribute('aria-activedescendant', 'Budget 2026');

  // Clearing the search from the list gives the header back.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
});
