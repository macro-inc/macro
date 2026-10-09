import { expect, type Page, test } from '@playwright/test';
import {
  canvasOf,
  dragOn,
  engineRows,
  fitted,
  infoOf,
  MOD,
  objectAt,
  open,
  pixelAt,
  selectedRows,
} from './helpers';
import { SAMPLE_COLORS } from './sample-document';

// The sample (`sample-document.ts`): a red rectangle (100,100)–(300,250),
// a blue circle (400,100)–(600,300) with a 4 pt black outline, and the
// text "Hello" (Inter 48 pt, baseline at (100,450)), on "Layer 1"; an
// empty layer "Notes" above.
const RED_BOX = { x: 200, y: 175 };
const BLUE_CIRCLE = { x: 500, y: 200 };
const HELLO = { x: 150, y: 435 };

/** Clicks canvas points (⇧ adds), and waits for the panel to show them. */
async function select(page: Page, ...points: { x: number; y: number }[]) {
  const view = await fitted(canvasOf(page));
  for (const [k, p] of points.entries()) {
    const s = view.at(p);
    if (k > 0) await page.keyboard.down('Shift');
    await page.mouse.click(s.x, s.y);
    if (k > 0) await page.keyboard.up('Shift');
  }
  await expect
    .poll(async () => (await selectedRows(page)).length)
    .toBe(points.length);
  await expect(page.getByTestId('ai-field-w')).toBeVisible();
}

/** Types into a panel field and commits it. */
async function setField(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.click();
  await field.fill(value);
  await field.press('Enter');
}

test('fill, stroke, opacity, and size from the properties panel', async ({
  page,
}) => {
  await open(page);
  const canvas = canvasOf(page);
  const view = await fitted(canvas);
  await select(page, RED_BOX);

  await setField(page, 'ai-fill-hex', '22aa44');
  await expect
    .poll(() => pixelAt(canvas, view.at(RED_BOX)))
    .toEqual([34, 170, 68]);

  // A stroke where there was none, then wider.
  await setField(page, 'ai-stroke-hex', '000000');
  await expect(page.getByTestId('ai-field-stroke-width')).toHaveValue('1');
  await setField(page, 'ai-field-stroke-width', '6');
  await expect
    .poll(async () => (await objectAt(page, RED_BOX))?.stroke?.width)
    .toBe(6);
  // Round joins.
  await page
    .getByTestId('ai-stroke-join')
    .getByRole('button', { name: 'Round join' })
    .click();
  await expect
    .poll(async () => (await objectAt(page, RED_BOX))?.stroke?.join)
    .toBe('round');

  await setField(page, 'ai-field-opacity', '50');
  const id = (await objectAt(page, RED_BOX))?.id ?? -1;
  await expect.poll(async () => (await infoOf(page, id))?.opacity).toBe(0.5);

  // The size fields measure the outline, as Illustrator does.
  await setField(page, 'ai-field-w', '300');
  await expect
    .poll(async () => (await infoOf(page, id))?.shapeBounds)
    .toEqual({ x0: 100, y0: 100, x1: 400, y1: 250 });
  await setField(page, 'ai-field-rotation', '90');
  await expect(page.getByTestId('ai-field-w')).toHaveValue('150');
  await expect(page.getByTestId('ai-field-h')).toHaveValue('300');
});

test('the toolbar swatches set the selection’s fill and stroke', async ({
  page,
}) => {
  await open(page);
  await select(page, BLUE_CIRCLE);
  // ⇧X swaps: a black fill, a blue stroke.
  await page.keyboard.press('Shift+x');
  await expect
    .poll(async () => (await objectAt(page, BLUE_CIRCLE))?.fill)
    .toEqual({ type: 'solid', color: { space: 'rgb', r: 0, g: 0, b: 0 } });
  // D: the defaults, white and a 1 pt black stroke.
  await page.keyboard.press('d');
  await expect
    .poll(async () => (await objectAt(page, BLUE_CIRCLE))?.fill)
    .toEqual({ type: 'solid', color: { space: 'gray', g: 1 } });
  await expect
    .poll(async () => (await objectAt(page, BLUE_CIRCLE))?.stroke?.width)
    .toBe(1);
  // None, from the fill swatch's picker.
  await page.getByTestId('ai-swatch-fill').click();
  await page.getByTestId('ai-swatch-fill-none').click();
  await expect
    .poll(async () => (await objectAt(page, { x: 401, y: 200 }))?.fill)
    .toBeNull();
});

test('the eyedropper takes an object’s appearance', async ({ page }) => {
  await open(page);
  const view = await fitted(canvasOf(page));
  await select(page, BLUE_CIRCLE);
  await page.keyboard.press('i');
  const red = view.at(RED_BOX);
  await page.mouse.click(red.x, red.y);
  await expect
    .poll(() => pixelAt(canvasOf(page), view.at(BLUE_CIRCLE)))
    .toEqual([...SAMPLE_COLORS.red]);
  await expect
    .poll(async () => (await objectAt(page, BLUE_CIRCLE))?.stroke)
    .toBeNull();
});

test('aligns, distributes, and combines with the pathfinder', async ({
  page,
}) => {
  await open(page);
  await select(page, RED_BOX, BLUE_CIRCLE);
  // Bottoms meet at the circle's.
  await page.getByTestId('ai-align-bottom').click();
  await expect
    .poll(async () => (await objectAt(page, { x: 200, y: 225 }))?.bounds)
    .toEqual({ x0: 100, y0: 150, x1: 300, y1: 300 });
  // Unite: one path where there were two.
  await page.getByTestId('ai-pathfinder-unite').click();
  await expect
    .poll(async () => (await engineRows(page)).filter((r) => r.kind === 'path'))
    .toHaveLength(1);
  await expect.poll(() => selectedRows(page)).toHaveLength(1);
});

test('clipping masks, outlines, and select all', async ({ page }) => {
  await open(page);
  const view = await fitted(canvasOf(page));
  await select(page, RED_BOX, BLUE_CIRCLE);
  await page.keyboard.press(`${MOD}+7`);
  // The circle on top becomes the group's clip; the rectangle is inside.
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.kind))
    .toEqual(['layer', 'layer', 'text', 'clipGroup', 'path']);
  // The mask (the circle, on top) hides the rectangle outside it.
  await expect
    .poll(() => pixelAt(canvasOf(page), view.at(RED_BOX)))
    .toEqual([255, 255, 255]);
  // Released, the clip group is a plain group again, as in Illustrator,
  // with the mask an unpainted path on top.
  await page.keyboard.press(`${MOD}+Alt+7`);
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.kind))
    .toEqual(['layer', 'layer', 'text', 'group', 'path', 'path']);
  expect((await engineRows(page)).slice(3).map((r) => r.name)).toEqual([
    'Group',
    'Path',
    'Red box',
  ]);

  // Create outlines turns the text into paths.
  await page.keyboard.press('Escape');
  await select(page, HELLO);
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect
    .poll(async () => (await engineRows(page)).filter((r) => r.kind === 'text'))
    .toHaveLength(0);

  // ⌘A selects every object: the outlined text and the group.
  await page.keyboard.press(`${MOD}+a`);
  await expect.poll(async () => (await selectedRows(page)).length).toBe(2);
});

test('text settings and polygon and star tools', async ({ page }) => {
  await open(page);
  const view = await fitted(canvasOf(page));
  await select(page, HELLO);
  await setField(page, 'ai-field-font-size', '72');
  await expect
    .poll(async () => {
      const id = (await objectAt(page, HELLO))?.id;
      return id === undefined ? null : (await infoOf(page, id))?.text?.size;
    })
    .toBe(72);
  await page
    .getByTestId('ai-text-align')
    .getByRole('button', { name: 'Align center' })
    .click();
  await expect
    .poll(async () => {
      const id = (await objectAt(page, HELLO))?.id;
      return id === undefined ? null : (await infoOf(page, id))?.text?.align;
    })
    .toBe('center');

  await page.keyboard.press('Escape');
  await page.getByTestId('ai-tool-polygon').click();
  await dragOn(page, view.at({ x: 600, y: 400 }), view.at({ x: 700, y: 500 }));
  await page.getByTestId('ai-tool-star').click();
  await dragOn(page, view.at({ x: 650, y: 50 }), view.at({ x: 750, y: 95 }));
  await expect
    .poll(async () => (await engineRows(page)).filter((r) => r.kind === 'path'))
    .toHaveLength(4);
});

test('rotates just outside a corner, ⇧ by 45°', async ({ page }) => {
  await open(page);
  const view = await fitted(canvasOf(page));
  await select(page, RED_BOX);
  const corner = view.at({ x: 300, y: 100 });
  // Outside the top-right corner, then around the center.
  const from = { x: corner.x + 10, y: corner.y - 10 };
  const center = view.at(RED_BOX);
  await page.keyboard.down('Shift');
  await dragOn(page, from, { x: center.x + 150, y: center.y + 150 }, 10);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('ai-field-rotation')).not.toHaveValue('0');
  const rotation = Number(
    await page.getByTestId('ai-field-rotation').inputValue()
  );
  expect(Math.abs(rotation) % 45).toBeCloseTo(0);
});

test('drags an object into another layer', async ({ page }) => {
  await open(page);
  const rows = page.getByTestId('ai-layer-row');
  // The rectangle (the bottom row), dropped into "Notes".
  await rows.nth(4).dragTo(rows.filter({ hasText: 'Notes' }), {
    targetPosition: { x: 60, y: 13 },
  });
  await expect
    .poll(async () =>
      (await engineRows(page)).map((r) => `${r.depth}:${r.name}`)
    )
    .toEqual(['0:Notes', '1:Red box', '0:Layer 1', '1:Hello', '1:Blue circle']);
});

test('pastes an image from the clipboard', async ({ page }) => {
  await open(page);
  await page.getByTestId('ai-canvas').click({ position: { x: 5, y: 5 } });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 40, 20);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
    if (!blob) return;
    const data = new DataTransfer();
    data.items.add(new File([blob], 'orange.png', { type: 'image/png' }));
    const target = document.querySelector('[data-testid="ai-canvas"]');
    target?.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect
    .poll(async () => (await engineRows(page)).map((r) => r.kind))
    .toContain('image');
  // Placed and selected, at its pixel size.
  await expect(page.getByTestId('ai-field-w')).toHaveValue('40');
  await expect(page.getByTestId('ai-field-h')).toHaveValue('20');
});

test('switches fonts, loading them first', async ({ page }) => {
  await open(page);
  await select(page, HELLO);
  await page.getByTestId('fig-font-family').click();
  await page.getByTestId('fig-font-search').fill('Roboto Mono');
  await page
    .locator('[data-testid="fig-font-option"][data-family="Roboto Mono"]')
    .click();
  // The stylesheet and file are fetched before the text is laid out.
  const requested = async (match: (r: string) => boolean) =>
    (await page.evaluate(() => window.aiFixture.fontRequests())).some(match);
  await expect
    .poll(() => requested((r) => r.includes('family=Roboto+Mono')))
    .toBe(true);
  await expect
    .poll(() => requested((r) => r.endsWith('InterVariable.ttf')))
    .toBe(true);
  await expect
    .poll(async () => {
      const id = (await objectAt(page, HELLO))?.id;
      return id === undefined ? null : (await infoOf(page, id))?.text?.family;
    })
    .toBe('Roboto Mono');
});

test('layers expand, collapse, take colors, and delete', async ({ page }) => {
  await open(page);
  const rows = page.getByTestId('ai-layer-row');
  const layer = rows.filter({ hasText: 'Layer 1' });
  await layer.getByTestId('ai-layer-toggle').click();
  await expect(rows).toHaveText(['Notes', 'Layer 1']);
  await layer.getByTestId('ai-layer-toggle').click();
  await expect(rows).toHaveCount(5);

  // A click on the color swatch gives the layer the next color.
  const id = Number(await layer.getAttribute('data-layer-id'));
  const color = async () =>
    (await engineRows(page)).find((r) => r.id === id)?.color;
  const first = await color();
  await layer.getByTestId('ai-layer-color').click();
  await expect.poll(color).not.toEqual(first);

  // Selected in the panel (and so on the canvas), then deleted.
  await rows.filter({ hasText: 'Red box' }).click();
  await expect.poll(() => selectedRows(page)).toEqual(['Red box']);
  await page.getByTestId('ai-layer-delete').click();
  await expect(rows).toHaveText(['Notes', 'Layer 1', 'Hello', 'Blue circle']);
});
