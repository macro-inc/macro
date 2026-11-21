import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/list-split.html';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

const list = (page: Page) =>
  page.getByRole('button', { name: 'Open row', exact: true });
const resize = (page: Page, width: number) =>
  page.evaluate((width) => window.setSplitWidth(width), width);

test('a new list split never shows an empty preview behind a toggle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.goto(`${fixture}?width=1000`);

  // Wide, the list docks beside the empty preview.
  await expect(list(page)).toBeVisible();
  await expect(page.getByText('Nothing selected')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show navigation' })
  ).toHaveCount(0);

  // Narrow, the list fills the split over the empty preview.
  await resize(page, 700);
  await expect(list(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show navigation' })
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const split = await page.getByTestId('split').boundingBox();
      const aside = await page.locator('[data-view-shell-aside]').boundingBox();
      return Math.round(split!.width - aside!.width);
    })
    .toBe(0);
  await expect
    .poll(() =>
      page.getByText('Nothing selected').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return !!document
          .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          ?.closest('[data-view-shell-aside]');
      })
    )
    .toBe(true);

  // A row fills the split with Back; Back returns to the list.
  await list(page).click();
  await expect(page.getByText('Row preview')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(list(page)).toBeVisible();

  await resize(page, 1000);
  await expect(list(page)).toBeVisible();
  await expect(page.getByText('Nothing selected')).toBeVisible();
});
