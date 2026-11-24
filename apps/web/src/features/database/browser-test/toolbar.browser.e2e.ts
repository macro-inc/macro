import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, query: string) {
  await page.goto(`/src/features/database/browser-test/toolbar.html?${query}`);
  await expect(page.getByRole('group', { name: 'Views' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** How far the pressed view tab reaches past either edge of the view rail, in pixels. */
function selectedTabOverflow(page: Page) {
  return page.getByRole('group', { name: 'Views' }).evaluate((rail) => {
    const tab = rail.querySelector('[aria-pressed="true"]');
    if (!tab) throw new Error('No view tab is pressed.');
    const railBox = rail.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    return Math.max(
      railBox.left - tabBox.left,
      tabBox.right - railBox.right,
      0
    );
  });
}

for (const width of [320, 390, 430]) {
  test.describe(`phone database page at ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    // When this fails, a phone has to scroll the page sideways to reach a
    // toolbar control, or a control is too small to tap.
    test('keeps every control on screen at a tappable size', async ({
      page,
    }) => {
      await open(page, 'mobile');

      const pageWidths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(pageWidths.scroll).toBe(pageWidths.client);

      const toolbar = page.locator('[data-database-toolbar]');
      for (const name of [
        'Table: Contract renewals for the coming fiscal year',
        'New record',
        'Search',
        'Filter',
        'Sort',
        'View actions',
      ]) {
        const box = await toolbar
          .getByRole('button', { name, exact: true })
          .boundingBox();
        if (!box) throw new Error(`${name} has no box.`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(36);
      }

      // An open search is the widest the first row gets.
      await toolbar.getByRole('button', { name: 'Search', exact: true }).tap();
      const search = await page
        .getByRole('combobox', { name: 'Search every table' })
        .boundingBox();
      const tables = await toolbar
        .getByRole('button', { name: /^Table: / })
        .boundingBox();
      if (!search || !tables) throw new Error('The first row has no boxes.');
      expect(search.x + search.width).toBeLessThanOrEqual(width);
      expect(tables.x).toBeGreaterThanOrEqual(0);
      expect(tables.width).toBeGreaterThanOrEqual(36);
    });

    test('switches tables from the table menu', async ({ page }) => {
      await open(page, 'mobile');

      await page.getByRole('button', { name: /^Table: / }).tap();
      await expect(
        page.getByRole('menuitemradio', {
          name: 'Contract renewals for the coming fiscal year',
        })
      ).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('menuitemradio', { name: 'Invoices' }).tap();

      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Table: Invoices' })
      ).toBeVisible();
    });

    // When this fails, the open view's tab is scrolled out of the rail, so the
    // toolbar no longer says which view is on screen.
    test('shows the selected view tab whole', async ({ page }) => {
      await open(page, 'mobile&selected=view-8');
      await expect.poll(() => selectedTabOverflow(page)).toBeLessThan(1);

      await page.getByRole('button', { name: 'All records' }).tap();
      await expect.poll(() => selectedTabOverflow(page)).toBeLessThan(1);
    });

    test('creates a view from the view actions menu with the keyboard', async ({
      page,
    }) => {
      await open(page, 'mobile');

      await page.getByRole('button', { name: 'View actions' }).focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('menuitem', { name: 'Table' })
      ).toHaveAttribute('data-highlighted', '');
      await page.keyboard.press('ArrowDown');
      await expect(
        page.getByRole('menuitem', { name: 'Board' })
      ).toHaveAttribute('data-highlighted', '');
      await page.keyboard.press('Enter');

      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Board view', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => selectedTabOverflow(page)).toBeLessThan(1);
    });

    test('renames and deletes the selected view from the view actions menu', async ({
      page,
    }) => {
      await open(page, 'mobile&selected=view-4');

      await page.getByRole('button', { name: 'View actions' }).tap();
      await page.getByRole('menuitem', { name: 'Rename view' }).tap();
      const name = page.getByRole('textbox', { name: 'View name' });
      await expect(name).toBeFocused();
      await name.fill('Late');
      await name.press('Enter');
      const renamed = page.getByRole('button', { name: 'Late', exact: true });
      await expect(renamed).toHaveAttribute('aria-pressed', 'true');

      await page.getByRole('button', { name: 'View actions' }).tap();
      await page.getByRole('menuitem', { name: 'Delete view' }).tap();
      await page.getByRole('button', { name: 'Delete view' }).tap();
      await expect(renamed).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'All records' })
      ).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

test.describe('desktop database page', () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  // When this fails, the desktop toolbar wrapped or lost its New view button.
  test('keeps one row with the New view button and no view actions menu', async ({
    page,
  }) => {
    await open(page, '');

    await expect(page.getByRole('button', { name: 'New view' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'View actions' })
    ).toHaveCount(0);
    const views = await page
      .getByRole('group', { name: 'Views' })
      .boundingBox();
    const record = await page
      .getByRole('button', { name: 'New record' })
      .boundingBox();
    if (!views || !record) throw new Error('The toolbar is not laid out.');
    expect(
      Math.abs(views.y + views.height / 2 - (record.y + record.height / 2))
    ).toBeLessThan(2);
  });
});
