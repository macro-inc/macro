import { expect, test } from '@playwright/test';
import {
  canvasOf,
  dragOn,
  engineRows,
  fitted,
  MOD,
  objectAt,
  open,
  pixelAt,
  selectedRows,
} from './helpers';
import { SAMPLE_COLORS } from './sample-document';

// The sample (`sample-document.ts`): artboard 800 × 600; on "Layer 1" a
// red rectangle (100,100)–(300,250), a blue circle (400,100)–(600,300)
// with a 4 pt black outline, and the text "Hello" (baseline at (100,450));
// an empty layer "Notes" above.
const RED_BOX = { x: 200, y: 175 };
const BLUE_CIRCLE = { x: 500, y: 200 };
const EMPTY = { x: 650, y: 500 };

test('opens a new document as the app creates it', async ({ page }) => {
  await open(page, '?new');
  await expect(page.getByTestId('ai-layer-row')).toHaveText(['Layer 1']);
  await expect(page.getByTestId('ai-toolbar')).toBeVisible();
  await expect(page.getByTestId('ai-illustrator-note')).toHaveCount(0);
  await page.getByTestId('ai-tab-artboards').click();
  await expect(page.getByTestId('ai-artboard-row')).toHaveCount(1);
  await expect(page.getByTestId('ai-artboard-row')).toContainText(
    '1920 × 1080'
  );
  // Nothing selected: the panel shows the artboard.
  await expect(page.getByTestId('ai-artboard-section')).toBeVisible();
});

test('renders the artwork and selects with the selection tool', async ({
  page,
}) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);
  await expect
    .poll(() => pixelAt(canvas, view.at(BLUE_CIRCLE)))
    .toEqual([...SAMPLE_COLORS.blue]);
  await expect(page.getByTestId('ai-layer-row')).toHaveText([
    'Notes',
    'Layer 1',
    'Hello',
    'Blue circle',
    'Red box',
  ]);

  // A click selects the rectangle: its row and its bounds.
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');
  await expect(page.getByTestId('ai-field-h')).toHaveValue('150');
  await expect.poll(() => selectedRows(page)).toEqual(['Red box']);

  // ⇧-click adds the circle; a click on empty canvas clears both.
  const blue = view.at(BLUE_CIRCLE);
  await page.keyboard.down('Shift');
  await page.mouse.click(blue.x, blue.y);
  await page.keyboard.up('Shift');
  await expect
    .poll(() => selectedRows(page))
    .toEqual(['Blue circle', 'Red box']);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('500');
  const empty = view.at(EMPTY);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(() => selectedRows(page)).toEqual([]);

  // A marquee selects what it touches.
  await dragOn(page, view.at({ x: 50, y: 50 }), view.at({ x: 350, y: 120 }));
  await expect.poll(() => selectedRows(page)).toEqual(['Red box']);
});

test('draws shapes with their tools and their defaults', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await canvas.click({ position: { x: 5, y: 5 } });

  // M: a rectangle over the drag, white with a 1 pt black stroke.
  await page.keyboard.press('m');
  await dragOn(page, view.at({ x: 100, y: 480 }), view.at({ x: 300, y: 560 }));
  await expect
    .poll(async () => (await objectAt(page, { x: 200, y: 520 }))?.bounds)
    .toEqual({ x0: 99.5, y0: 479.5, x1: 300.5, y1: 560.5 });
  const rect = await objectAt(page, { x: 200, y: 520 });
  expect(rect?.fill).toEqual({
    type: 'solid',
    color: { space: 'gray', g: 1 },
  });
  expect(rect?.stroke?.width).toBe(1);
  // The new shape is selected.
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');

  // L with ⇧: a circle.
  await page.keyboard.press('l');
  await page.keyboard.down('Shift');
  await dragOn(page, view.at({ x: 650, y: 400 }), view.at({ x: 750, y: 450 }));
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => (await objectAt(page, { x: 700, y: 450 }))?.bounds)
    .toEqual({ x0: 649.5, y0: 399.5, x1: 750.5, y1: 500.5 });

  // \ draws a line.
  await page.keyboard.press('Backslash');
  await dragOn(page, view.at({ x: 350, y: 350 }), view.at({ x: 550, y: 350 }));
  const rows = await engineRows(page);
  expect(rows.filter((r) => r.kind === 'path')).toHaveLength(5);
});

test('moves, nudges, undoes, and redoes', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await dragOn(page, red, view.at({ x: RED_BOX.x + 100, y: RED_BOX.y + 50 }));
  await expect
    .poll(async () => (await objectAt(page, { x: 300, y: 225 }))?.bounds)
    .toEqual({ x0: 200, y0: 150, x1: 400, y1: 300 });

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByTestId('ai-field-x')).toHaveValue('201');
  await expect(page.getByTestId('ai-field-y')).toHaveValue('160');

  // The nudges undo together, then the move.
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId('ai-field-x')).toHaveValue('200');
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId('ai-field-x')).toHaveValue('100');
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(page.getByTestId('ai-field-x')).toHaveValue('200');
  await expect(page.getByTestId('ai-redo')).toBeEnabled();
  await page.getByTestId('ai-undo').click();
  await expect(page.getByTestId('ai-field-x')).toHaveValue('100');
});

test('scales with the bounding box and duplicates with ⌥-drag', async ({
  page,
}) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');
  // The bottom-right handle, dragged 100 pt right and down.
  await dragOn(page, view.at({ x: 300, y: 250 }), view.at({ x: 400, y: 350 }));
  await expect(page.getByTestId('ai-field-w')).toHaveValue('300');
  await expect(page.getByTestId('ai-field-h')).toHaveValue('250');
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');

  // ⌥-drag leaves the original and moves a copy.
  await page.keyboard.down('Alt');
  await dragOn(page, red, view.at({ x: RED_BOX.x, y: RED_BOX.y + 250 }));
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await engineRows(page)).length).toBe(6);
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);
  // The copy, right of the text.
  await expect
    .poll(() => pixelAt(canvas, view.at({ x: 280, y: 425 })))
    .toEqual([...SAMPLE_COLORS.red]);
});

test('edits text in place and makes new text', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const hello = view.at({ x: 150, y: 435 });
  await page.mouse.dblclick(hello.x, hello.y);
  await expect(page.getByTestId('ai-text-editing')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type(' world');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ai-text-editing')).toHaveCount(0);
  await expect
    .poll(async () => (await objectAt(page, { x: 150, y: 435 }))?.text)
    .toBe('Hello world');

  // T: a click starts point text there.
  await page.keyboard.press('t');
  const at = view.at({ x: 450, y: 520 });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('ai-text-editing')).toBeVisible();
  await page.keyboard.type('Fresh');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () =>
      (await engineRows(page))
        .filter((r) => r.kind === 'text')
        .map((r) => r.name)
    )
    .toEqual(['Fresh', 'Hello world']);
});

test('the layers panel hides, locks, renames, adds, and reorders', async ({
  page,
}) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const rows = page.getByTestId('ai-layer-row');
  // The rectangle is the bottom row.
  const box = rows.nth(4);

  await box.hover();
  await box.getByTestId('ai-layer-visibility').click();
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([255, 255, 255]);
  await box.getByTestId('ai-layer-visibility').click();
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);

  // Locked objects can't be selected on the canvas.
  await box.hover();
  await box.getByTestId('ai-layer-lock').click();
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect.poll(() => selectedRows(page)).toEqual([]);
  await box.getByTestId('ai-layer-lock').click();

  // Double-click renames.
  await box.dblclick();
  await page.getByTestId('ai-layer-rename').fill('Logo');
  await page.keyboard.press('Enter');
  await expect(rows.nth(4)).toHaveText('Logo');

  // A new layer goes on top.
  await page.getByTestId('ai-layer-new').click();
  await expect(rows.first()).toHaveText('Layer 3');

  // Dragging the rectangle above the text puts it in front.
  await rows
    .filter({ hasText: 'Logo' })
    .dragTo(rows.filter({ hasText: 'Hello' }), {
      targetPosition: { x: 40, y: 3 },
    });
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.name))
    .toEqual(['Layer 3', 'Notes', 'Layer 1', 'Logo', 'Hello', 'Blue circle']);
});

test('groups, arranges, copies, pastes, and deletes', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const red = view.at(RED_BOX);
  const blue = view.at(BLUE_CIRCLE);
  const rect = (await objectAt(page, RED_BOX))?.id;
  const circle = (await objectAt(page, BLUE_CIRCLE))?.id;
  await page.mouse.click(red.x, red.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(blue.x, blue.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => selectedRows(page)).toHaveLength(2);

  await page.keyboard.press(`${MOD}+g`);
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.kind))
    .toEqual(['layer', 'layer', 'text', 'group', 'path', 'path']);
  await page.keyboard.press(`${MOD}+Shift+g`);
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.kind))
    .toEqual(['layer', 'layer', 'text', 'path', 'path']);

  // ⌘] brings the rectangle in front of the circle (rows: top-most first).
  await page.mouse.click(red.x, red.y);
  await expect.poll(() => selectedRows(page)).toHaveLength(1);
  const order = async () => {
    const ids = (await engineRows(page)).map((r) => r.id);
    return ids.indexOf(rect ?? -1) < ids.indexOf(circle ?? -1);
  };
  expect(await order()).toBe(false);
  await page.keyboard.press(`${MOD}+BracketRight`);
  await expect.poll(order).toBe(true);

  // Copy and paste: a copy 10 pt away, selected.
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await expect(page.getByTestId('ai-field-x')).toHaveValue('110');
  await expect.poll(async () => (await engineRows(page)).length).toBe(6);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await engineRows(page)).length).toBe(5);

  // ⌘D duplicates.
  await page.mouse.click(blue.x, blue.y);
  await expect.poll(() => selectedRows(page)).toHaveLength(1);
  await page.keyboard.press(`${MOD}+d`);
  await expect.poll(async () => (await engineRows(page)).length).toBe(6);
});

test('direct selection moves anchor points', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('a');
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');
  // The rectangle's top-left anchor, dragged up and left.
  await dragOn(page, view.at({ x: 100, y: 100 }), view.at({ x: 50, y: 60 }));
  await expect
    .poll(async () => (await objectAt(page, { x: 200, y: 200 }))?.bounds)
    .toEqual({ x0: 50, y0: 60, x1: 300, y1: 250 });
});

test('the pen draws a closed path', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  for (const p of [
    { x: 600, y: 400 },
    { x: 750, y: 400 },
    { x: 700, y: 550 },
    { x: 600, y: 400 },
  ]) {
    const s = view.at(p);
    await page.mouse.click(s.x, s.y);
  }
  await expect
    .poll(async () => (await objectAt(page, { x: 680, y: 430 }))?.bounds)
    .toEqual({ x0: 599.5, y0: 399.5, x1: 750.5, y1: 550.5 });
});

test('artboards: draw, rename, and delete', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+-`);
  await page.keyboard.press(`${MOD}+-`);
  await page.keyboard.press('Shift+o');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  // Empty canvas to the right of the artboard.
  await dragOn(
    page,
    { x: box.x + box.width - 160, y: box.y + 200 },
    { x: box.x + box.width - 60, y: box.y + 300 }
  );
  await page.getByTestId('ai-tab-artboards').click();
  await expect(page.getByTestId('ai-artboard-row')).toHaveCount(2);
  await page
    .getByTestId('ai-artboard-row')
    .nth(1)
    .locator('button')
    .first()
    .dblclick();
  await page.getByTestId('ai-artboard-rename').fill('Back');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ai-artboard-row').nth(1)).toContainText(
    'Back'
  );
  await page.getByTestId('ai-artboard-row').nth(1).hover();
  await page
    .getByTestId('ai-artboard-row')
    .nth(1)
    .getByTestId('ai-artboard-delete')
    .click();
  await expect(page.getByTestId('ai-artboard-row')).toHaveCount(1);
});

test('outline view, zoom shortcuts, and exports', async ({ page }) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+y`);
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([255, 255, 255]);
  await page.keyboard.press(`${MOD}+y`);
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([...SAMPLE_COLORS.red]);

  await page.keyboard.press(`${MOD}+1`);
  await expect(page.getByTestId('ai-zoom-menu')).toHaveText('100%');
  await page.keyboard.press(`${MOD}+0`);
  await expect(page.getByTestId('ai-zoom-menu')).not.toHaveText('100%');

  await page.getByTestId('ai-main-menu').click();
  await page.getByTestId('ai-menu-export-png').click();
  await page.getByTestId('ai-main-menu').click();
  await page.getByTestId('ai-menu-download').click();
  await expect
    .poll(() => page.evaluate(() => window.aiFixture.downloads()))
    .toEqual([
      { name: 'Poster.png', size: expect.any(Number) },
      { name: 'Illustration.ai', size: expect.any(Number) },
    ]);
});

test('saves edits, and the saved file opens with them', async ({ page }) => {
  await open(page, '?sample&reload');
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect(page.getByTestId('ai-field-w')).toHaveValue('200');
  await page.keyboard.press('Delete');
  await expect
    .poll(() => page.evaluate(() => window.aiFixture.saves().length))
    .toBe(1);
  await expect(page.getByTestId('ai-save-state')).toHaveAttribute(
    'data-state',
    'saved'
  );
  // A rename in the layers panel is in the next saved file too.
  await page
    .getByTestId('ai-layer-row')
    .filter({ hasText: 'Blue circle' })
    .dblclick();
  await page.getByTestId('ai-layer-rename').fill('Sun');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.aiFixture.saves().length))
    .toBe(2);
  const saved = await page.evaluate(async () => {
    const saves = window.aiFixture.saves();
    const last = saves[saves.length - 1];
    if (!last) return null;
    return (await window.aiFixture.rowsOf(last)).map(
      (r) => `${r.kind} ${r.name}`
    );
  });
  expect(saved).toEqual([
    'layer Notes',
    'layer Layer 1',
    'text Hello',
    'path Sun',
  ]);
});

test('a viewer sees the document but cannot change it', async ({ page }) => {
  await open(page, '?sample&readonly');
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await expect(page.getByTestId('ai-tool-rectangle')).toHaveCount(0);
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect.poll(() => selectedRows(page)).toEqual(['Red box']);
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await engineRows(page)).length).toBe(5);
  await expect(page.getByTestId('ai-field-x')).toHaveValue('100');
});

test('pans with Space, zooms with the wheel and the zoom tool', async ({
  page,
}) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  const red = view.at(RED_BOX);
  await canvas.click({ position: { x: 5, y: 5 } });
  // Space-drag pans: the rectangle follows the pointer, and stays put in
  // the document.
  await page.keyboard.down('Space');
  await dragOn(page, red, { x: red.x + 100, y: red.y + 60 });
  await page.keyboard.up('Space');
  await expect
    .poll(() => pixelAt(canvas, { x: red.x + 100, y: red.y + 60 }))
    .toEqual([...SAMPLE_COLORS.red]);
  expect((await objectAt(page, RED_BOX))?.bounds).toEqual({
    x0: 100,
    y0: 100,
    x1: 300,
    y1: 250,
  });

  // ⌘+wheel zooms at the pointer.
  const zoom = page.getByTestId('ai-zoom-menu');
  const before = await zoom.textContent();
  await page.mouse.move(red.x + 100, red.y + 60);
  await page.keyboard.down(MOD);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up(MOD);
  await expect(zoom).not.toHaveText(before ?? '');
  // The point under the pointer stays under it.
  await expect
    .poll(() => pixelAt(canvas, { x: red.x + 100, y: red.y + 60 }))
    .toEqual([...SAMPLE_COLORS.red]);

  // The zoom tool: a click zooms in a step, ⌥-click out.
  const percent = async () =>
    Number.parseInt((await zoom.textContent()) ?? '0');
  await page.keyboard.press(`${MOD}+0`);
  const fit = await percent();
  await page.keyboard.press('z');
  const c = await canvas.boundingBox();
  if (!c) throw new Error('no canvas');
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await expect.poll(percent).toBeGreaterThan(fit);
  const zoomedIn = await percent();
  await page.keyboard.down('Alt');
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await page.keyboard.up('Alt');
  await expect.poll(percent).toBeLessThan(zoomedIn);
});
