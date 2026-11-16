import { type CDPSession, expect, type Page, test } from '@playwright/test';

type Point = { x: number; y: number };

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Point[]
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, id) => ({ ...point, id })),
  });
}

const canvas = (page: Page) =>
  page.evaluate(() => {
    const { editor } = window.canvasTouchFixture;
    const { selectedIds, canUndo } = editor.getSession();
    return {
      items: Object.keys(editor.document.items).length,
      selectedIds,
      canUndo,
      scale: editor.getCamera().scale,
    };
  });

/** The centre of the fixture's filled rectangle, on screen. */
async function filledShape(page: Page): Promise<Point> {
  const box = await page.locator('[data-graphics-item="filled"]').boundingBox();
  if (!box) throw new Error('The filled rectangle is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch layout coverage');
  await page.goto('/touch.html');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();
});

test('the tools sit above the dock, uncovered, in place of the New button', async ({
  page,
}) => {
  const dock = await page.getByTestId('dock').boundingBox();
  if (!dock) throw new Error('The dock is not rendered');
  const tools = page.getByLabel('Drawing tools').getByRole('button');
  await expect(tools).toHaveCount(8);

  for (const tool of await tools.all()) {
    const box = await tool.boundingBox();
    if (!box) throw new Error('A tool is not rendered');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    // Nothing is drawn over the button's centre.
    const reachable = await tool.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return button.contains(hit);
    });
    expect(reachable).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0);
});

test('the controls sit in the canvas where the page has no bottom chrome', async ({
  page,
}) => {
  await page.goto('/touch.html?chrome=none');
  const tools = page.getByLabel('Drawing tools');
  await expect(tools).toBeVisible();

  const viewport = page.viewportSize();
  const box = await tools.boundingBox();
  if (!viewport || !box) throw new Error('The tools are not rendered');
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await page.getByRole('button', { name: 'Hand tool' }).tap();
  await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('a grouped tool is picked by a tap and opens its group on the next', async ({
  page,
}) => {
  const shapes = page.getByRole('button', { name: 'Rectangle tool' });
  await shapes.tap();
  await expect(shapes).toHaveAttribute('aria-pressed', 'true');

  await shapes.tap();
  await page.getByRole('menuitem', { name: 'Ellipse' }).tap();
  await expect(
    page.getByRole('button', { name: 'Ellipse tool' })
  ).toHaveAttribute('aria-pressed', 'true');
});

test('a selection brings up its actions, each one undo step', async ({
  page,
}) => {
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  expect((await canvas(page)).selectedIds).toEqual(['filled']);

  await page.getByRole('button', { name: 'Duplicate' }).tap();
  expect((await canvas(page)).items).toBe(4);
  await page.getByRole('button', { name: 'Delete' }).tap();
  expect((await canvas(page)).items).toBe(3);

  await page.getByRole('button', { name: 'Undo' }).tap();
  expect((await canvas(page)).items).toBe(4);
  await page.getByRole('button', { name: 'Undo' }).tap();
  expect((await canvas(page)).items).toBe(3);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Style opens the inspector under the shape and a tap on the canvas closes it', async ({
  page,
}) => {
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  await page.getByRole('button', { name: 'Style' }).tap();

  const sheet = page.getByRole('dialog', { name: 'Canvas inspector' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Fill', { exact: true })).toBeAttached();
  // The sheet slides up; a tap during the slide is not yet a dismissal.
  let lastTop: number | undefined;
  await expect
    .poll(async () => {
      const top = (await sheet.boundingBox())?.y;
      const settled = top !== undefined && top === lastTop;
      lastTop = top;
      return settled;
    })
    .toBe(true);
  // It rests below the selected shape and its handles.
  const [sheetBox, boundsBox] = await Promise.all([
    sheet.boundingBox(),
    page.locator('[data-graphics-selection-bounds]').boundingBox(),
  ]);
  if (!sheetBox || !boundsBox) throw new Error('Nothing is selected');
  expect(boundsBox.y + boundsBox.height).toBeLessThan(sheetBox.y);

  await page.touchscreen.tap(shape.x + 150, 40);
  await expect(sheet).toHaveCount(0);
  expect((await canvas(page)).selectedIds).toEqual(['filled']);
});

test('a long press selects what is under the finger and its menu outlives the lift', async ({
  page,
}) => {
  await page.clock.install();
  const cdp = await page.context().newCDPSession(page);
  const shape = await filledShape(page);
  const sheet = page.getByRole('dialog', { name: 'Canvas actions' });

  // A few pixels of drift is still a press.
  await touch(cdp, 'touchStart', [shape]);
  await touch(cdp, 'touchMove', [{ x: shape.x + 4, y: shape.y + 3 }]);
  await page.clock.runFor(600);
  await expect(sheet).toBeVisible();
  await touch(cdp, 'touchEnd', []);

  await expect(sheet).toBeVisible();
  const state = await canvas(page);
  expect(state.selectedIds).toEqual(['filled']);
  expect(state.canUndo).toBe(false);
  await expect(
    sheet.getByRole('button', { name: 'Paste', exact: true })
  ).toBeEnabled();
});

test('a press that becomes a drag moves the shape and opens no menu', async ({
  page,
}) => {
  await page.clock.install();
  const cdp = await page.context().newCDPSession(page);
  const shape = await filledShape(page);

  await touch(cdp, 'touchStart', [shape]);
  await touch(cdp, 'touchMove', [{ x: shape.x + 20, y: shape.y + 20 }]);
  await touch(cdp, 'touchMove', [{ x: shape.x + 40, y: shape.y + 40 }]);
  await page.clock.runFor(600);
  await touch(cdp, 'touchEnd', []);

  await expect(
    page.getByRole('dialog', { name: 'Canvas actions' })
  ).toHaveCount(0);
  const moved = await filledShape(page);
  expect(moved.x).toBeCloseTo(shape.x + 40, 0);
  expect(moved.y).toBeCloseTo(shape.y + 40, 0);
});

test('the zoom button offers fit and the grid', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom options' }).tap();
  const sheet = page.getByRole('dialog', { name: 'View' });
  await expect(
    sheet.getByRole('menuitemcheckbox', { name: 'Dot grid' })
  ).toHaveAttribute('aria-checked', 'true');

  await sheet.getByRole('button', { name: 'Zoom to fit' }).tap();
  await expect(sheet).toHaveCount(0);
  expect((await canvas(page)).scale).not.toBe(1);
});

test('a finger takes a corner from outside it and moves the shape from its middle', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  const size = () =>
    page.evaluate(() => {
      const item = window.canvasTouchFixture.editor.document.items.filled;
      if (item?.type !== 'rectangle') return undefined;
      return {
        width: Math.round(item.geometry.width),
        height: Math.round(item.geometry.height),
      };
    });
  const box = await page.locator('[data-graphics-item="filled"]').boundingBox();
  if (!box) throw new Error('The filled rectangle is not rendered');

  // 12px outside the bottom-right corner, where a cursor would find nothing.
  const corner = { x: box.x + box.width + 9, y: box.y + box.height + 8 };
  await touch(cdp, 'touchStart', [corner]);
  await touch(cdp, 'touchMove', [{ x: corner.x + 20, y: corner.y + 15 }]);
  await touch(cdp, 'touchMove', [{ x: corner.x + 40, y: corner.y + 30 }]);
  await touch(cdp, 'touchEnd', []);
  expect(await size()).toEqual({ width: 180, height: 130 });

  const middle = await filledShape(page);
  await touch(cdp, 'touchStart', [middle]);
  await touch(cdp, 'touchMove', [{ x: middle.x + 15, y: middle.y + 10 }]);
  await touch(cdp, 'touchMove', [{ x: middle.x + 30, y: middle.y + 20 }]);
  await touch(cdp, 'touchEnd', []);
  expect(await size()).toEqual({ width: 180, height: 130 });
  const moved = await filledShape(page);
  expect(moved.x).toBeCloseTo(middle.x + 30, 0);
});

test('a tap near the stroke of an outlined shape selects it', async ({
  page,
}) => {
  const box = await page
    .locator('[data-graphics-item="outline"]')
    .boundingBox();
  if (!box) throw new Error('The outlined ellipse is not rendered');

  // 8px inside the ellipse's leftmost point: no paint under the finger.
  await page.touchscreen.tap(box.x + 8, box.y + box.height / 2);

  expect((await canvas(page)).selectedIds).toEqual(['outline']);
});
