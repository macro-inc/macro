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

async function openInHeader(page: Page, width: number) {
  const { field } = await open(page, `?surface=header&width=${width}`);
  await field.pressSequentially('budget');
  return field.evaluate((input) => {
    const frame = input.closest('[data-search-bar]')!.getBoundingClientRect();
    const row = input.closest('[data-view-shell-top-bar] > :last-child')!;
    return {
      width: frame.width,
      right: frame.right,
      rowRight: row.getBoundingClientRect().right,
      overflow: row.scrollWidth - row.clientWidth,
    };
  });
}

test('narrows the open field to keep it whole beside the header actions', async ({
  page,
}) => {
  const narrow = await openInHeader(page, 560);
  expect(narrow.overflow).toBeLessThanOrEqual(0);
  expect(narrow.right).toBeLessThanOrEqual(narrow.rowRight);
  expect(narrow.width).toBeGreaterThanOrEqual(96);
  await expect(
    page.getByRole('button', { name: 'Close search' })
  ).toBeInViewport({ ratio: 1 });

  // With room beside the actions, the field keeps its full width.
  const wide = await openInHeader(page, 700);
  expect(wide.width).toBeCloseTo(224, 0);
  expect(wide.right).toBeLessThanOrEqual(wide.rowRight);
});

test('New drops its label in a narrow header so the open field fits', async ({
  page,
}) => {
  const narrow = await openInHeader(page, 550);
  expect(narrow.overflow).toBeLessThanOrEqual(0);
  expect(narrow.width).toBeGreaterThanOrEqual(96);
  await expect(
    page.getByRole('button', { name: 'Close search' })
  ).toBeInViewport({ ratio: 1 });

  const create = page.getByRole('button', { name: 'New' });
  await expect(create).toBeInViewport({ ratio: 1 });
  await expect(create.getByText('New')).toBeHidden();
  // The plus icon and the menu caret both stay.
  expect(
    await create
      .locator('svg')
      .evaluateAll(
        (icons) =>
          icons.filter((icon) => icon.getBoundingClientRect().width > 0).length
      )
  ).toBe(2);
  await create.hover();
  await expect(page.getByRole('tooltip')).toHaveText('New');

  await openInHeader(page, 700);
  await expect(
    page.getByRole('button', { name: 'New' }).getByText('New')
  ).toBeVisible();
});

test('a New without a menu becomes a 32px square in a narrow header', async ({
  page,
}) => {
  await open(page, '?surface=header&width=550&plainNew');
  const create = page.getByRole('button', { name: 'New' });
  await expect(create.getByText('New')).toBeHidden();
  const box = await create.boundingBox();
  expect(box?.width).toBeCloseTo(32, 0);
  expect(box?.height).toBeCloseTo(32, 0);
});
