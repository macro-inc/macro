import { expect, type Page, test } from '@playwright/test';

type Presence = {
  userId: string;
  rowId?: string;
  columnId?: string;
  endRowId?: string;
  endColumnId?: string;
  editing: boolean;
};

const ALEX = 'macro|alex@example.com';
const SAM = 'macro|sam@example.com';

async function open(page: Page) {
  await page.goto('/src/features/database/browser-test/grid.html');
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function present(page: Page, users: Presence[]) {
  await page.evaluate((next) => {
    Reflect.get(window, 'setRemoteUsers')(next);
  }, users);
  // Let the style and any observers settle before measuring.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
}

/** Every row's and cell's box, rounded to hundredths of a pixel. */
function layout(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="row"], [data-grid-cell]'
      ),
    ].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height].map(
        (value) => Math.round(value * 100) / 100
      );
    })
  );
}

function cell(page: Page, rowId: string, column: number) {
  return page.locator(
    `[data-grid-row-id="${rowId}"] [data-grid-cell][data-grid-column="${column}"]`
  );
}

/** Whether the label's center is painted by the label, not by what covers it. */
function labelOnTop(page: Page, name: string) {
  return page.getByRole('note', { name }).evaluate((label) => {
    // Hit testing skips elements that ignore the pointer, as labels do.
    label.style.pointerEvents = 'auto';
    const { x, y, width, height } = label.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    label.style.pointerEvents = '';
    return !!hit && label.contains(hit);
  });
}

const MOVES: Presence[][] = [
  [{ userId: ALEX, rowId: 'row-0', columnId: 'title', editing: false }],
  [{ userId: ALEX, rowId: 'row-1', columnId: 'owner', editing: false }],
  // The wrapped row, while editing.
  [{ userId: ALEX, rowId: 'row-3', columnId: 'notes', editing: true }],
  [
    { userId: ALEX, rowId: 'row-2', columnId: 'owner', editing: false },
    { userId: SAM, rowId: 'row-2', columnId: 'owner', editing: true },
  ],
  [
    {
      userId: SAM,
      rowId: 'row-4',
      columnId: 'title',
      endRowId: 'row-6',
      endColumnId: 'notes',
      editing: false,
    },
  ],
  [],
];

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`remote presence never moves a row or cell on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await open(page);
    const before = await layout(page);
    for (const users of MOVES) {
      await present(page, users);
      expect(await layout(page), JSON.stringify(users)).toEqual(before);
    }

    // The last row, scrolled to the bottom.
    await page
      .locator('[data-grid]')
      .evaluate((grid) =>
        grid.parentElement!.scrollTo({ top: grid.scrollHeight })
      );
    await present(page, []);
    const bottom = await layout(page);
    await present(page, [
      { userId: ALEX, rowId: 'row-29', columnId: 'notes', editing: false },
    ]);
    expect(await layout(page)).toEqual(bottom);
  });
}

test('the name sits above the top-right of the cell, readable on the first row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await present(page, [
    { userId: ALEX, rowId: 'row-0', columnId: 'owner', editing: false },
    { userId: SAM, rowId: 'row-0', columnId: 'owner', editing: true },
  ]);
  const target = (await cell(page, 'row-0', 2).boundingBox())!;
  const alex = (await page
    .getByRole('note', { name: 'Alex is here' })
    .boundingBox())!;
  const sam = (await page
    .getByRole('note', { name: 'Sam is editing' })
    .boundingBox())!;
  for (const label of [alex, sam]) {
    expect(label.y + label.height).toBeCloseTo(target.y, 0);
    expect(label.x).toBeGreaterThanOrEqual(target.x - 1);
  }
  // The first collaborator takes the corner, inside the cell's 1px divider;
  // the next sits to its left.
  expect(
    Math.abs(alex.x + alex.width - (target.x + target.width))
  ).toBeLessThanOrEqual(1);
  expect(sam.x + sam.width).toBeLessThanOrEqual(alex.x);
  // Above the sticky header, not clipped by it or the scroll container.
  expect(await labelOnTop(page, 'Alex is here')).toBe(true);
  expect(await labelOnTop(page, 'Sam is editing')).toBe(true);
});

test('a label hides under the header once its cell scrolls beneath it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await present(page, [
    { userId: ALEX, rowId: 'row-10', columnId: 'title', editing: false },
  ]);
  const scrollTo = (rowId: string, offset: number) =>
    page.locator('[data-grid]').evaluate(
      (grid, [id, by]) => {
        const scroller = grid.parentElement!;
        const header = grid.querySelector<HTMLElement>('[aria-rowindex="1"]')!;
        const row = grid.querySelector<HTMLElement>(
          `[data-grid-row-id="${id}"]`
        )!;
        // Virtual rows are placed by transform, so offsetTop is always 0.
        const rowTop =
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        scroller.scrollTop = rowTop - header.offsetHeight + by;
      },
      [rowId, offset] as const
    );
  // The row is the first one under the header: its label covers the header.
  await scrollTo('row-10', 0);
  await expect.poll(() => labelOnTop(page, 'Alex is here')).toBe(true);
  // The cell has gone beneath the header: so has its label.
  await scrollTo('row-10', 20);
  await expect.poll(() => labelOnTop(page, 'Alex is here')).toBe(false);
  await scrollTo('row-10', -200);
  await expect.poll(() => labelOnTop(page, 'Alex is here')).toBe(true);
});
