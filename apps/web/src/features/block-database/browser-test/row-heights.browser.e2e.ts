import { expect, type Page, test } from '@playwright/test';
import { openFixture } from './open-fixture';

/** Rows whose next row doesn't start where they end, or whose cells overflow them. */
function misplacedRows(page: Page) {
  return page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[role=row][data-index]'),
    ]
      .map((row) => ({
        index: Number(row.dataset.index),
        rect: row.getBoundingClientRect(),
        content: Math.max(
          ...[...row.querySelectorAll<HTMLElement>('[role=gridcell]')].map(
            (cell) => cell.scrollHeight
          )
        ),
      }))
      .sort((a, b) => a.index - b.index);
    return rows.flatMap((row, position) => {
      const next = rows[position + 1];
      const gap =
        next?.index === row.index + 1
          ? next.rect.top - row.rect.bottom
          : undefined;
      return (gap !== undefined && Math.abs(gap) > 0.5) ||
        row.content > row.rect.height + 0.5
        ? [{ index: row.index, height: row.rect.height, gap }]
        : [];
    });
  });
}

/** Contacts whose given row renders taller than the rest, as a wrapped or still-loading cell does. */
async function openContacts(page: Page, tallRowId: string) {
  await page.addInitScript((rowId) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `[data-grid-row-id="${rowId}"] [role=gridcell]:not(:first-child) { min-height: 56px }`;
      document.head.append(style);
    });
  }, tallRowId);
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await openFixture(
    page,
    '/src/features/block-database/browser-test/records.html?contacts'
  );
  await expect(page.locator('[role=row][data-index]').first()).toBeVisible();
}

async function scrollGrid(page: Page, steps: number[]) {
  await page.evaluate(async (deltas) => {
    let element = document.querySelector<HTMLElement>('[role=row][data-index]');
    while (element && element.scrollHeight <= element.clientHeight + 1)
      element = element.parentElement;
    for (const delta of deltas) {
      element!.scrollBy(0, delta);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, steps);
}

test('a row taller than the first keeps its own height', async ({ page }) => {
  await openContacts(page, 'contact-7');
  await expect.poll(() => misplacedRows(page)).toEqual([]);
  const tall = page.locator('[data-grid-row-id="contact-7"]');
  await expect(tall).toHaveJSProperty('offsetHeight', 57);

  // Scrolled away and back, it mounts as a preview, which must not clip it.
  await scrollGrid(page, Array(12).fill(400));
  await scrollGrid(page, Array(12).fill(-400));
  await expect(tall).toBeVisible();
  expect(await misplacedRows(page)).toEqual([]);
  await expect.poll(() => misplacedRows(page)).toEqual([]);
});

test('rows shorter than the first leave no gaps', async ({ page }) => {
  await openContacts(page, 'contact-0');
  await expect.poll(() => misplacedRows(page)).toEqual([]);
  await scrollGrid(page, Array(10).fill(300));
  await expect.poll(() => misplacedRows(page)).toEqual([]);
});
