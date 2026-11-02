import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, rows = 30) {
  await page.goto(`/src/features/database/browser-test/grid.html?rows=${rows}`);
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

function cell(page: Page, rowId: string, column: number) {
  return page.locator(
    `[data-grid-row-id="${rowId}"] [data-grid-cell][data-grid-column="${column}"]`
  );
}

function selected(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[aria-selected="true"]')].map(
      (element) =>
        `${element.closest<HTMLElement>('[data-grid-row-id]')!.dataset.gridRowId}:${element.dataset.gridColumn}`
    )
  );
}

/** Whether the element's center is on screen, below the sticky header and above the summary. */
function inView(page: Page, rowId: string, column: number) {
  return cell(page, rowId, column).evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return !!hit && element.contains(hit);
  });
}

test('Shift+Arrow grows and shrinks a range and keeps its moving corner in view', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await cell(page, 'row-1', 1).focus();

  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await selected(page)).toEqual([
    'row-1:1',
    'row-1:2',
    'row-2:1',
    'row-2:2',
    'row-3:1',
    'row-3:2',
  ]);
  await page.screenshot({ path: testInfo.outputPath('keyboard-range.png') });

  await page.keyboard.press('Shift+ArrowUp');
  expect(await selected(page)).toHaveLength(4);

  // Down to the last row, far below the fold.
  await page.keyboard.press('Shift+ControlOrMeta+ArrowDown');
  expect(await selected(page)).toHaveLength(29 * 2);
  await expect.poll(() => inView(page, 'row-29', 2)).toBe(true);

  // A plain arrow collapses it.
  await page.keyboard.press('ArrowUp');
  expect(await selected(page)).toEqual([]);
});

test('Shift+Cmd/Ctrl+Arrow reaches and scrolls to a row the virtualizer had not mounted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 300);
  await expect(cell(page, 'row-299', 1)).toHaveCount(0);
  await cell(page, 'row-0', 1).focus();

  await page.keyboard.press('Shift+ControlOrMeta+ArrowDown');

  await expect.poll(() => inView(page, 'row-299', 1)).toBe(true);
  await expect(cell(page, 'row-299', 1)).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[data-grid-row-id="row-299"] [data-grid-column="1"]'
          )
      )
    )
    .toBe(true);
  await page.keyboard.press('Shift+ArrowUp');
  await expect(cell(page, 'row-299', 1)).toHaveAttribute(
    'aria-selected',
    'false'
  );
});

test('a collaborator’s range is drawn with the presence ring', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await page.evaluate(() =>
    Reflect.get(
      window,
      'setRemoteUsers'
    )([
      {
        userId: 'macro|alex@example.com',
        rowId: 'row-1',
        columnId: 'title',
        endRowId: 'row-3',
        endColumnId: 'owner',
        editing: false,
      },
    ])
  );
  await expect(page.getByRole('note', { name: 'Alex is here' })).toBeVisible();
  await expect(page.locator('[data-remote-outline]')).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath('remote-range.png') });
});
