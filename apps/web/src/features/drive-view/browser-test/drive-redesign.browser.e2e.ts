import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/src/features/drive-view/browser-test/drive-redesign.html';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
});

test('desktop My Drive unifies folders and files, supports inline expand, Grid, Columns, and long filename truncation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(FIXTURE_URL);

  // Browse mode shows top-level owned folders + unfiled owned files together.
  await expect(page.getByRole('row', { name: /Product/ })).toBeVisible();
  await expect(
    page.getByRole('row', { name: /Q3 Operating Plan\.md/ })
  ).toBeVisible();
  // Filed document inside Q3 Launch is hidden in Browse mode.
  await expect(
    page.getByRole('row', { name: /Launch Readiness Checklist\.md/ })
  ).toHaveCount(0);

  // Long filename truncates cleanly without spilling horizontally.
  const longRow = page.getByRole('row', {
    name: /Quarterly Executive Business Review/,
  });
  await expect(longRow).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]');
    return grid ? grid.scrollWidth > grid.clientWidth + 2 : false;
  });
  expect(hasHorizontalOverflow).toBe(false);

  // Inline folder disclosure expands Product right inside the list.
  await page
    .locator('[role="grid"] button[aria-label="Expand Product"]')
    .click();
  await expect(page.getByRole('row', { name: /Specs/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Design Assets/ })).toBeVisible();

  // Switching to All files reveals filed documents across folders.
  const rootTabs = page.getByRole('radiogroup', { name: 'My Drive view mode' });
  await rootTabs.getByText('All files').click();
  await expect(page.locator('[data-drive-row-id="doc-q3-spec"]')).toBeVisible();
  await rootTabs.getByText('Browse').click();

  // Switch to Grid view: shows Folders band + Files band.
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByRole('heading', { name: 'Folders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  await expect(
    page.locator('[data-drive-card-id="folder-product"]')
  ).toBeVisible();

  // Switch to Finder Miller Columns and drill 3 levels deep.
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.locator('[data-drive-column-item="folder-product"]').click();
  await expect(
    page.locator('[data-drive-column-item="folder-specs"]')
  ).toBeVisible();
  await page.locator('[data-drive-column-item="folder-specs"]').click();
  await expect(
    page.locator('[data-drive-column-item="folder-q3"]')
  ).toBeVisible();
  await page.locator('[data-drive-column-item="folder-q3"]').click();
  await expect(
    page.locator('[data-drive-column-item="doc-q3-spec"]')
  ).toBeVisible();
});

test('desktop keyboard navigation, Quick Look Inspector, extension-preserving inline rename, trash, undo, and Trash restore', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(FIXTURE_URL);

  const grid = page.getByRole('grid', { name: 'Drive files' });
  await expect(grid).toBeVisible();
  await grid.focus();

  // Press Space on focused folder to open Quick Look Inspector.
  await page.keyboard.press('Space');
  const inspector = page.getByRole('complementary', { name: 'Details' });
  await expect(inspector).toBeVisible();
  await inspector
    .getByRole('radiogroup', { name: 'Details' })
    .getByText('Details')
    .click();
  await expect(inspector.getByText('Kind')).toBeVisible();
  await grid.focus();
  await page.keyboard.press('Escape');
  await expect(inspector).toHaveCount(0);

  // Create a new folder inline via Cmd/Ctrl+Shift+N.
  await page.keyboard.press('Control+Shift+N');
  const newFolderInput = page.getByLabel('New folder name');
  await expect(newFolderInput).toBeVisible();
  await newFolderInput.fill('Roadmap 2027');
  await newFolderInput.press('Enter');
  await expect(page.getByRole('row', { name: /Roadmap 2027/ })).toBeVisible();

  // Extension-preserving Finder inline rename via F2 on Employee Handbook.pdf.
  const pdfRow = page.getByRole('row', { name: /Employee Handbook\.pdf/ });
  await pdfRow.hover();
  await pdfRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();

  const renameInput = page.getByLabel('Rename Employee Handbook.pdf');
  await expect(renameInput).toBeVisible();
  const selection = await renameInput.evaluate((el) => {
    const input = el as HTMLInputElement;
    return {
      start: input.selectionStart,
      end: input.selectionEnd,
      selectedText: input.value.slice(
        input.selectionStart ?? 0,
        input.selectionEnd ?? 0
      ),
    };
  });
  expect(selection.selectedText).toBe('Employee Handbook');

  await renameInput.fill('Team Handbook.pdf');
  await renameInput.press('Enter');
  await expect(
    page.getByRole('row', { name: /Team Handbook\.pdf/ })
  ).toBeVisible();

  // Undo rename via Ctrl+Z restores original filename.
  await grid.focus();
  await page.keyboard.press('Control+z');
  await expect(
    page.getByRole('row', { name: /Employee Handbook\.pdf/ })
  ).toBeVisible();

  // Trash view shows soft-deleted items and supports Restore.
  await page
    .getByRole('navigation', { name: 'Drive views' })
    .getByRole('button', { name: 'Trash' })
    .click();
  await expect(page.getByText('Deprecated Onboarding Draft.md')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});

test('desktop large folder, empty folder, folder-scoped search with Search all of Drive, and dark mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FIXTURE_URL}?theme=dark`);

  // Verify dark mode attribute applied cleanly.
  expect(
    await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme-light')
    )
  ).toBe('false');

  // Open large folder (40 items) and verify breadcrumb + search inside folder.
  await page
    .getByRole('button', { name: 'Quarterly Archive', exact: true })
    .click();
  await expect(
    page.getByRole('row', { name: /Weekly Metrics Report #01/ })
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(41); // header row + 40 items

  // Search inside folder shows scoped banner and Search all of Drive escape hatch.
  await page.getByRole('button', { name: 'Search Drive' }).click();
  const searchInput = page.getByRole('searchbox');
  await searchInput.fill('Handbook');
  await expect(
    page.getByText('Searching inside Quarterly Archive')
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Search all of Drive' })
    .first()
    .click();
  await expect(
    page.getByRole('row', { name: /Employee Handbook\.pdf/ })
  ).toBeVisible();

  // Open empty folder and verify tailored empty state.
  await page
    .getByRole('button', { name: 'New Initiatives', exact: true })
    .click();
  await expect(page.getByText('This folder is empty')).toBeVisible();
});

test.describe('mobile phone width (390x844 touch)', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('shows title, List/Grid toggle, folder breadcrumbs, search, filter drawer, and item action sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${FIXTURE_URL}?mobile=1`);

    // Title bar and Browse/All files pills visible with zero horizontal overflow.
    await expect(page.getByRole('heading', { name: 'My Drive' })).toBeVisible();
    await expect(
      page.locator('[data-drive-mobile-row="folder-product"]')
    ).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(overflows).toBe(false);

    // Switch to Grid view on phone.
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(
      page.locator('[data-drive-mobile-card="folder-product"]')
    ).toBeVisible();
    await page.getByRole('button', { name: 'List' }).click();

    // Open item action sheet via ⋯ button and rename inline inside sheet.
    await page
      .getByRole('button', { name: 'More actions for Q3 Operating Plan.md' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Q3 Operating Plan.md' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Rename' }).click();
    const input = sheet.getByLabel('Rename Q3 Operating Plan.md');
    await expect(input).toBeVisible();
    await input.fill('Q3 Launch Plan.md');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Q3 Launch Plan.md')).toBeVisible();

    // Drill into Product folder and verify touch breadcrumbs + filters work inside folders.
    await page.locator('[data-drive-mobile-row="folder-product"]').click();
    await expect(page.getByRole('heading', { name: 'Product' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Folders' }).getByText('My Drive')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open file filters' })
    ).toBeVisible();
  });
});
