import {
  type CDPSession,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

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

/** Wait until a sheet has stopped sliding. */
async function settle(sheet: Locator) {
  let lastTop: number | undefined;
  await expect
    .poll(async () => {
      const top = (await sheet.boundingBox())?.y;
      const settled = top !== undefined && top === lastTop;
      lastTop = top;
      return settled;
    })
    .toBe(true);
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
  await settle(sheet);
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

test('the lift of a long press presses nothing in the menu that opened under it', async ({
  page,
}) => {
  // The sheet slides up in real time, and this finger has to lift at once for
  // the browser to count it a tap. Without the slide the sheet is under the
  // finger by then, as it is for a person, who lifts later.
  await page.addStyleTag({
    content: '[data-corvu-drawer-content] { transition: none !important; }',
  });
  await page.clock.install();
  const cdp = await page.context().newCDPSession(page);
  const sheet = page.getByRole('dialog', { name: 'Canvas actions' });
  const selectAll = sheet.getByRole('button', { name: 'Select all' });

  // More opens the same sheet, which shows where Select all comes to rest.
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  await page.getByRole('button', { name: 'More actions' }).tap();
  await page.clock.runFor(800);
  await expect(selectAll).toBeInViewport();
  const row = await selectAll.boundingBox();
  if (!row) throw new Error('Select all is not rendered');
  const finger = { x: row.x + row.width / 2, y: row.y + row.height / 2 };
  await page.touchscreen.tap(shape.x + 180, 40);
  await page.clock.runFor(800);
  await expect(sheet).toBeHidden();

  // What the browser clicks, read ahead of whoever handles the click.
  await page.evaluate(() =>
    window.addEventListener(
      'click',
      (event) => {
        const button =
          event.target instanceof Element && event.target.closest('button');
        document.documentElement.dataset.clicked = button
          ? (button.textContent ?? '').trim()
          : 'elsewhere';
      },
      true
    )
  );

  // A finger held on the canvas where that row will be. The sheet takes its
  // place over a few frames of the page's clock.
  await touch(cdp, 'touchStart', [finger]);
  await page.clock.runFor(600);
  const rowUnderFinger = () =>
    selectAll.evaluate(
      (button, point) =>
        button.contains(document.elementFromPoint(point.x, point.y)),
      finger
    );
  for (let tick = 0; tick < 40 && !(await rowUnderFinger()); tick++)
    await page.clock.runFor(50);
  expect(await rowUnderFinger()).toBe(true);
  const held = await canvas(page);
  await touch(cdp, 'touchEnd', []);

  // The browser clicks the row as the finger lifts, and the row is not pressed.
  await expect(
    page.locator('html'),
    'The browser clicks for a lift that comes soon enough to be a tap'
  ).toHaveAttribute('data-clicked', 'Select all');
  expect(await canvas(page)).toEqual(held);
  await expect(sheet).toBeVisible();

  // A tap on the row straight afterwards is its own, and presses it.
  await selectAll.tap();
  await page.clock.runFor(800);
  await expect(sheet).toBeHidden();
  expect((await canvas(page)).selectedIds).toContain('outline');
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

test('a tap beside the end of a selected connector leaves it, and a drag from there moves it', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  // Arrow, Line and Connector share a button: the second tap opens the group.
  const lines = page.getByRole('button', { name: 'Arrow tool' });
  await lines.tap();
  await lines.tap();
  await page.getByRole('menuitem', { name: 'Connector' }).tap();
  // Drawn across empty canvas, to the right of the fixture's shapes.
  await touch(cdp, 'touchStart', [{ x: 250, y: 120 }]);
  await touch(cdp, 'touchMove', [{ x: 300, y: 150 }]);
  await touch(cdp, 'touchMove', [{ x: 350, y: 180 }]);
  await touch(cdp, 'touchEnd', []);

  const connector = () =>
    page.evaluate(() => {
      const { editor } = window.canvasTouchFixture;
      const item = Object.values(editor.document.items).find(
        (candidate) => candidate.type === 'connector'
      );
      if (!item) return undefined;
      editor.select(item.id);
      return JSON.stringify(item.geometry);
    });
  const drawn = await connector();
  expect(drawn).toBeDefined();

  const handle = await page
    .getByRole('img', { name: 'Connector end' })
    .boundingBox();
  if (!handle) throw new Error("The connector's end is not rendered");
  // 11px from the middle of the end's handle: beside it, within a finger's reach.
  const beside = {
    x: handle.x + handle.width / 2 + 9,
    y: handle.y + handle.height / 2 + 6,
  };
  await page.touchscreen.tap(beside.x, beside.y);
  expect(await connector()).toBe(drawn);

  await touch(cdp, 'touchStart', [beside]);
  await touch(cdp, 'touchMove', [{ x: beside.x + 20, y: beside.y + 15 }]);
  await touch(cdp, 'touchMove', [{ x: beside.x + 40, y: beside.y + 30 }]);
  await touch(cdp, 'touchEnd', []);
  expect(await connector()).not.toBe(drawn);
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

/** The smallest valid PNG: one transparent pixel. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test('Attach is a sheet of finger-sized rows, and Upload media reaches the file picker', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Attach' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Attach' });
  for (const name of ['Media', 'Upload media', 'Reference']) {
    const row = await sheet
      .getByRole('button', { name, exact: true })
      .boundingBox();
    expect(row?.height, name).toBeGreaterThanOrEqual(44);
  }

  const opened = page.waitForEvent('filechooser');
  await sheet.getByRole('button', { name: 'Upload media' }).tap();
  const picker = await opened;
  expect(picker.isMultiple()).toBe(true);

  // The sheet is gone while the picker is open, and the files still arrive.
  await expect(sheet).toBeHidden();
  await picker.setFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  });
  await expect
    .poll(() => page.evaluate(() => window.canvasTouchFixture.uploads))
    .toEqual(['photo.png']);
});

test('Attach starts from its rows again after a picker was dismissed', async ({
  page,
}) => {
  const attach = page.getByRole('button', { name: 'Attach' });
  const rows = page.getByRole('dialog', { name: 'Attach' });
  const picker = page.getByRole('dialog', { name: 'Insert media' });
  await attach.tap();
  await rows.getByRole('button', { name: 'Media', exact: true }).tap();
  await expect(picker).toBeVisible();
  await expect(rows).toBeHidden();

  // The picker slides up; a tap during the slide is not yet a dismissal.
  await settle(picker);
  await page.touchscreen.tap(200, 40);
  await expect(picker).toBeHidden();
  await expect(attach).toHaveAttribute('aria-expanded', 'false');
  // The keyboard is back on the canvas, for its shortcuts.
  await expect(page.getByLabel('Graphics canvas')).toBeFocused();

  await attach.tap();
  await expect(rows).toBeVisible();
  await expect(picker).toBeHidden();
});

/** The box around every item of the scene, on screen. */
const sceneBox = (page: Page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-graphics-item]')].map(
      (item) => item.getBoundingClientRect()
    );
    return {
      left: Math.min(...boxes.map((box) => box.left)),
      top: Math.min(...boxes.map((box) => box.top)),
      right: Math.max(...boxes.map((box) => box.right)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
  });

/**
 * The scene point in the middle of the canvas that no chrome covers, and that
 * middle on screen.
 */
const middleOfView = (page: Page) =>
  page.evaluate(() => {
    // The bottom chrome (the float host), which `--mobile-content-inset-bottom`
    // publishes to the elements that clear it.
    const covered =
      document
        .querySelector('[data-float-region]')
        ?.parentElement?.getBoundingClientRect().height ?? 0;
    const screen = { x: innerWidth / 2, y: (innerHeight - covered) / 2 };
    const { x, y, scale } = window.canvasTouchFixture.editor.getCamera();
    return {
      screen,
      scene: { x: (screen.x - x) / scale, y: (screen.y - y) / scale },
      scale,
    };
  });

test('Zoom to fit shows the whole scene clear of the bottom chrome', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Zoom options' }).tap();
  await page.getByRole('button', { name: 'Zoom to fit' }).tap();

  const viewport = page.viewportSize();
  const chrome = await page
    .getByRole('button', { name: 'Zoom options' })
    .boundingBox();
  if (!viewport || !chrome) throw new Error('The chrome is not rendered');
  // The fit leaves 24px clear all round and fills the room one way or the
  // other; strokes reach a little past their shapes.
  const room = (await middleOfView(page)).screen.y * 2;
  await expect
    .poll(async () => {
      const scene = await sceneBox(page);
      return (
        scene.right - scene.left > viewport.width - 48 - 12 ||
        scene.bottom - scene.top > room - 48 - 12
      );
    })
    .toBe(true);
  const scene = await sceneBox(page);
  expect(scene.left).toBeGreaterThanOrEqual(24 - 4);
  expect(scene.right).toBeLessThanOrEqual(viewport.width - 24 + 4);
  expect(scene.top).toBeGreaterThanOrEqual(24 - 4);
  expect(scene.bottom).toBeLessThanOrEqual(chrome.y - 24 + 4);
});

test('turning the device keeps what was in the middle in the middle', async ({
  page,
}) => {
  const before = await middleOfView(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport');

  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });

  // The chrome is laid out again after the turn, so allow for its change.
  await expect
    .poll(async () => {
      const after = await middleOfView(page);
      return Math.hypot(
        (after.scene.x - before.scene.x) * after.scale,
        (after.scene.y - before.scene.y) * after.scale
      );
    })
    .toBeLessThan(48);
  expect((await middleOfView(page)).scale).toBe(before.scale);
});

test('a fill is picked from swatches in the sheet, with the shape still in view', async ({
  page,
}) => {
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  await page.getByRole('button', { name: 'Style' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Canvas inspector' });
  await settle(sheet);

  const swatches = sheet.getByRole('group', { name: 'Fill colors' });
  const accent = swatches.getByRole('button', { name: 'Fill: Accent' });
  await accent.scrollIntoViewIfNeeded();
  const box = await accent.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await accent.tap();

  // The colour is on the shape, and no picker opened over it.
  await expect(accent).toHaveAttribute('aria-pressed', 'true');
  const customPicker = page.getByRole('textbox', { name: 'hex' });
  await expect(customPicker).toHaveCount(0);
  const fill = await page.evaluate(() => {
    const item = window.canvasTouchFixture.editor.document.items.filled;
    return item?.type === 'rectangle' ? item.appearance.fill : undefined;
  });
  expect(fill).toBe('var(--color-accent)');
  await expect(sheet).toBeVisible();
  const [sheetBox, bounds] = await Promise.all([
    sheet.boundingBox(),
    page.locator('[data-graphics-selection-bounds]').boundingBox(),
  ]);
  if (!sheetBox || !bounds) throw new Error('Nothing is selected');
  expect(bounds.y + bounds.height).toBeLessThan(sheetBox.y);

  // A custom colour is still one tap away.
  await sheet.getByRole('button', { name: 'Fill color picker' }).tap();
  await expect(customPicker).toBeVisible();
});

/**
 * A pen going down, moving while down, or lifting: CDP sends a pen as a mouse
 * of pointer type pen.
 */
async function pen(
  cdp: CDPSession,
  type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
  point: Point
) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'pen',
  });
}

/**
 * Where the text being started sits in the scene, if one is. The fixture's
 * camera is at rest, so that is also where it is on screen. (The editor itself
 * needs the app's providers and does not mount here.)
 */
const textBeingEdited = (page: Page) =>
  page.evaluate(() => {
    const draft = window.canvasTouchFixture.state.text.draft();
    if (!draft) return undefined;
    return {
      x: Math.round(draft.transform[4]),
      y: Math.round(draft.transform[5]),
    };
  });

test('with the Text tool a pen keeps its press whichever of pen and palm lands first', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const textTool = page.getByRole('button', { name: 'Text tool' });
  const palm = { x: 120, y: 560 };

  // The pen presses, then the palm comes to rest and lifts.
  const first = { x: 280, y: 120 };
  await textTool.tap();
  await pen(cdp, 'mousePressed', first);
  await touch(cdp, 'touchStart', [palm]);
  await touch(cdp, 'touchEnd', []);
  expect(await textBeingEdited(page)).toBeUndefined();
  await pen(cdp, 'mouseReleased', first);
  const afterPenFirst = await textBeingEdited(page);
  expect(Math.abs((afterPenFirst?.x ?? 0) - first.x)).toBeLessThan(12);
  await page.evaluate(() => window.canvasTouchFixture.state.text.finish());
  // The Text tool keeps its press from the scene, and the pen still counts as
  // used: drawing is now the pen's.
  expect(
    await page.evaluate(() => window.canvasTouchFixture.state.penOnly())
  ).toBe(true);

  // The palm rests first; the pen then taps while it is still down.
  const second = { x: 260, y: 240 };
  await textTool.tap();
  await touch(cdp, 'touchStart', [palm]);
  await pen(cdp, 'mousePressed', second);
  await pen(cdp, 'mouseReleased', second);
  const afterPalmFirst = await textBeingEdited(page);
  expect(Math.abs((afterPalmFirst?.x ?? 0) - second.x)).toBeLessThan(12);
  expect(Math.abs((afterPalmFirst?.y ?? 0) - second.y)).toBeLessThan(40);
  // The palm lifting afterwards starts nothing of its own.
  await touch(cdp, 'touchEnd', []);
  const stillThePensText = await textBeingEdited(page);
  expect(stillThePensText).toEqual(afterPalmFirst);
});

test('a long press on an item in a group offers to select it alone', async ({
  page,
}) => {
  await page.clock.install();
  const cdp = await page.context().newCDPSession(page);
  // Group the fixture's two shapes, then let go of the group.
  const group = await page.evaluate(() => {
    const { editor, state } = window.canvasTouchFixture;
    editor.selectMany(['filled', 'outline']);
    state.group();
    const [id] = editor.getSession().selectedIds;
    editor.selectMany([]);
    return id;
  });
  const shape = await filledShape(page);
  const sheet = page.getByRole('dialog', { name: 'Canvas actions' });

  await touch(cdp, 'touchStart', [shape]);
  await page.clock.runFor(600);
  await touch(cdp, 'touchEnd', []);
  // The press selects the group, as a tap does.
  expect((await canvas(page)).selectedIds).toEqual([group]);
  await sheet.getByRole('button', { name: 'Select inside group' }).tap();

  await expect(sheet).toBeHidden();
  expect((await canvas(page)).selectedIds).toEqual(['filled']);

  // More has no place the finger pressed, so it does not offer it.
  await page.getByRole('button', { name: 'More actions' }).tap();
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: 'Select inside group' })
  ).toHaveCount(0);
  // The sheet slides up on the page's clock; a tap during the slide is not
  // yet a dismissal.
  await page.clock.runFor(800);
  await settle(sheet);
  await page.touchscreen.tap(shape.x + 180, 40);
  await page.clock.runFor(800);
  await expect(sheet).toBeHidden();

  // A second long press on the item is about the item, not its group again.
  await touch(cdp, 'touchStart', [shape]);
  await page.clock.runFor(600);
  await touch(cdp, 'touchEnd', []);
  await expect(sheet).toBeVisible();
  expect((await canvas(page)).selectedIds).toEqual(['filled']);
});

test('with the tool kept, one choice of Rectangle draws several', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const rectangle = page.getByRole('button', { name: 'Rectangle tool' });
  const before = (await canvas(page)).items;
  /** One finger dragged across empty canvas, to the right of the fixture's shapes. */
  const draw = async (y: number) => {
    await touch(cdp, 'touchStart', [{ x: 250, y }]);
    await touch(cdp, 'touchMove', [{ x: 300, y: y + 30 }]);
    await touch(cdp, 'touchMove', [{ x: 350, y: y + 60 }]);
    await touch(cdp, 'touchEnd', []);
  };

  // As it comes: one shape, and Select is back.
  await rectangle.tap();
  await draw(120);
  await expect(rectangle).toHaveAttribute('aria-pressed', 'false');
  expect((await canvas(page)).items).toBe(before + 1);

  await page.getByRole('button', { name: 'Zoom options' }).tap();
  const keep = page
    .getByRole('dialog', { name: 'View' })
    .getByRole('menuitemcheckbox', { name: 'Keep tool after drawing' });
  await keep.tap();
  await expect(keep).toHaveAttribute('aria-checked', 'true');
  await page.touchscreen.tap(380, 40);
  await expect(page.getByRole('dialog', { name: 'View' })).toBeHidden();

  await rectangle.tap();
  await draw(240);
  await draw(360);
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  expect((await canvas(page)).items).toBe(before + 3);
});

test('once a pen has drawn, a finger under a drawing tool pans until fingers are given it back', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const rectangle = page.getByRole('button', { name: 'Rectangle tool' });
  const view = page.getByRole('dialog', { name: 'View' });
  const camera = () =>
    page.evaluate(() => window.canvasTouchFixture.editor.getCamera());
  /** One finger dragged 100 right and 60 down across empty canvas. */
  const drag = async (from: Point) => {
    await touch(cdp, 'touchStart', [from]);
    await touch(cdp, 'touchMove', [{ x: from.x + 50, y: from.y + 30 }]);
    await touch(cdp, 'touchMove', [{ x: from.x + 100, y: from.y + 60 }]);
    await touch(cdp, 'touchEnd', []);
  };
  const before = (await canvas(page)).items;
  const rest = await camera();

  const zoomOptions = page.getByRole('button', { name: 'Zoom options' });
  const penOnly = view.getByRole('menuitemcheckbox', {
    name: 'Draw with pen only',
  });
  const closeView = async () => {
    await page.touchscreen.tap(380, 40);
    await expect(view).toBeHidden();
  };

  // With no pen about, a finger draws, and the sheet has nothing to offer.
  await rectangle.tap();
  await drag({ x: 250, y: 120 });
  expect((await canvas(page)).items).toBe(before + 1);
  expect(await camera()).toEqual(rest);
  await zoomOptions.tap();
  await settle(view);
  await expect(penOnly).toHaveCount(0);
  await closeView();

  // The pen draws a shape.
  await rectangle.tap();
  await pen(cdp, 'mousePressed', { x: 250, y: 260 });
  await pen(cdp, 'mouseMoved', { x: 320, y: 310 });
  await pen(cdp, 'mouseReleased', { x: 320, y: 310 });
  expect((await canvas(page)).items).toBe(before + 2);

  // From then on a finger under the same tool moves the canvas instead. The
  // pan starts at the drag's first move, once the finger has shown it is
  // moving, and may glide on a little after the lift.
  await rectangle.tap();
  await drag({ x: 250, y: 400 });
  expect((await canvas(page)).items).toBe(before + 2);
  const panned = await camera();
  expect(panned.x - rest.x).toBeGreaterThanOrEqual(49);
  expect(panned.y - rest.y).toBeGreaterThanOrEqual(29);

  // The view sheet now offers the choice. Switched off, the finger draws again.
  await zoomOptions.tap();
  await expect(penOnly).toHaveAttribute('aria-checked', 'true');
  await penOnly.tap();
  await expect(penOnly).toHaveAttribute('aria-checked', 'false');
  await closeView();

  await drag({ x: 250, y: 400 });
  expect((await canvas(page)).items).toBe(before + 3);
});
