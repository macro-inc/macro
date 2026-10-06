import { expect, type Page, test } from '@playwright/test';

// The engine's synthetic fixture (crates/fig_engine/src/testing.rs): page
// "Screens" holds frames "Home" and "Settings"; "Home" holds "Header" (a
// blue-to-purple gradient), "Avatar", a white "Card", and an instance
// "Primary button" whose "Background" is overridden to orange. Page
// "Components" holds the "Button" component.
const SHOWCASE = 'showcase.fig';

async function open(page: Page) {
  await page.goto(`/?file=${encodeURIComponent(SHOWCASE)}`);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect.poll(() => inkedFraction(page)).toBeGreaterThan(0.05);
}

/** The tile canvas's pixels, read back. */
function pixel(page: Page, fx: number, fy: number) {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .first()
    .evaluate(
      (node, [x, y]) => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [0, 0, 0, 0];
        const at = ctx.getImageData(
          Math.floor(canvas.width * x),
          Math.floor(canvas.height * y),
          1,
          1
        ).data;
        return [at[0], at[1], at[2], at[3]];
      },
      [fx, fy]
    );
}

/** Share of tile-canvas pixels that differ from its corner (0 = blank). */
function inkedFraction(page: Page): Promise<number> {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .first()
    .evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width < 2) return 0;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const [r, g, b] = [data[0], data[1], data[2]];
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        const d =
          Math.abs(data[i] - r) +
          Math.abs(data[i + 1] - g) +
          Math.abs(data[i + 2] - b);
        if (d > 40) inked++;
      }
      return inked / (data.length / 4);
    });
}

async function canvasCenter(page: Page) {
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Selects a layer through the layer search, then zooms to it. */
async function focusLayer(page: Page, name: string) {
  if (!(await page.getByTestId('fig-layer-search').isVisible()))
    await page.getByTestId('fig-search-toggle').click();
  await page.getByTestId('fig-layer-search').fill(name);
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: name })
    .first()
    .click();
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(page.getByTestId('fig-design-panel')).toContainText(name);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Shift+2');
}

test('lists pages and layers and renders the page', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('fig-page')).toHaveText([
    'Screens',
    'Components',
  ]);
  // Top-most first, as Figma lists layers.
  await expect(page.getByTestId('fig-layer-row')).toHaveText([
    'Settings',
    'Home',
  ]);
  await expect(page.getByTestId('fig-design-panel')).toContainText('Page');
});

test('selects layers with Figma’s click rules', async ({ page }) => {
  await open(page);
  await focusLayer(page, 'Card');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Card');
  // Zoomed to the white card: its middle is white.
  await expect.poll(() => pixel(page, 0.5, 0.5)).toEqual([255, 255, 255, 255]);

  // Esc climbs to the frame, then clears the selection.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Home');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    'Canvas color'
  );

  // A click inside a top-level frame selects the frame's child directly.
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('fig-design-panel')).toContainText('Card');
  await expect(page.getByTestId('fig-design-panel')).toContainText('312');
});

test('double-clicks into instances', async ({ page }) => {
  await open(page);
  await focusLayer(page, 'Primary button');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    'Primary button'
  );
  // The override, not the component's blue.
  await expect
    .poll(async () => {
      const [r, g, b] = await pixel(page, 0.5, 0.5);
      return r > 200 && g < 120 && b < 80;
    })
    .toBe(true);
  const c = await canvasCenter(page);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    'Background'
  );
});

test('navigates frames and pages from the keyboard', async ({ page }) => {
  await open(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('n');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Home');
  await page.keyboard.press('n');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Settings');
  await page.keyboard.press('Shift+n');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Home');

  await page.keyboard.press('PageDown');
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Button']);
  await page.keyboard.press('PageUp');
  // Top-most first, as Figma lists layers.
  await expect(page.getByTestId('fig-layer-row')).toHaveText([
    'Settings',
    'Home',
  ]);
});

test('zooms with Figma’s shortcuts', async ({ page }) => {
  await open(page);
  const zoom = page.getByTestId('fig-zoom-menu');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Shift+0');
  await expect(zoom).toHaveText(/100%/);
  await page.keyboard.press('ControlOrMeta+=');
  await expect(zoom).toHaveText(/200%/);
  await page.keyboard.press('Shift+1');
  await expect(zoom).not.toHaveText(/200%/);
});

test('exports the selection and shows the shortcuts', async ({ page }) => {
  await open(page);
  await focusLayer(page, 'Header');
  // A read-only viewer exports with presets kept for the session.
  const exports = page.getByTestId('fig-export');
  await exports.getByRole('button', { name: 'Add export' }).click();
  await page.getByTestId('fig-export-size-0').fill('2x');
  await page.getByTestId('fig-export-size-0').press('Enter');
  await page.getByTestId('fig-export-button').click();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.downloads()))
    .toEqual([{ name: 'Header@2x.png', size: expect.any(Number) }]);

  await page.keyboard.press('Control+Shift+?');
  await expect(page.getByTestId('fig-shortcuts')).toBeVisible();
  await expect(page.getByTestId('fig-shortcuts')).toContainText(
    'Zoom to selection'
  );
});

// ---- editing (a new blank design; saves stay in memory and are reopened) --

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

/** A drag on the canvas between two canvas-relative points. */
async function dragOnCanvas(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
}

const savedCount = (page: Page) =>
  page.evaluate(() => window.figFixture.saves().length);

test('draws, moves, and saves shapes', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('r');
  // A new design opens at 100% with the page origin at the top left.
  await dragOnCanvas(page, [100, 100], [220, 180]);
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Rectangle 1']);
  await expect(page.getByTestId('fig-field-w')).toHaveValue('120');
  await expect(page.getByTestId('fig-field-h')).toHaveValue('80');

  await dragOnCanvas(page, [150, 140], [200, 170]);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('150');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('130');
  await expect.poll(() => pixel(page, 0, 0)).not.toEqual([0, 0, 0, 0]);

  // Saved after a pause, and each save reopens (`reload`).
  await expect
    .poll(() => savedCount(page), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
});

/** The color of the tile canvas at a canvas point (CSS pixels). */
function colorAt(page: Page, x: number, y: number) {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .first()
    .evaluate(
      (node, [px, py]) => {
        const c = node as HTMLCanvasElement;
        const k = c.width / c.getBoundingClientRect().width;
        const [r, g, b] = c
          .getContext('2d')
          ?.getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data ?? [
          0, 0, 0,
        ];
        if (r > 200 && g < 60 && b < 60) return 'red';
        if (b > 200 && r < 60 && g < 60) return 'blue';
        return 'other';
      },
      [x, y]
    );
}

/** Sets the selection's first fill. */
async function fillSelection(page: Page, hex: string) {
  await page.getByTestId('fig-fill-0-hex').fill(hex);
  await page.getByTestId('fig-fill-0-hex').press('Enter');
}

test('moves layers lifted off the page, one edit at the drop', async ({
  page,
}) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  const fill = (hex: string) => fillSelection(page, hex);
  // A red layer, then a blue one above it.
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [200, 200]);
  await fill('FF0000');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [300, 100], [400, 200]);
  await fill('0000FF');
  // The tile canvas at a canvas point (100% shows page units).
  const color = (x: number, y: number) => colorAt(page, x, y);
  const redX = async () => {
    const engine = await page.evaluateHandle(() => window.figFixture.engine());
    return engine.evaluate(async (e) => {
      if (!e) return undefined;
      const rows = await e.layers(0);
      const red = rows.find((r) => r.name === 'Rectangle 1');
      const [g] = red ? await e.geometry(0, [red.id]) : [];
      return g?.bounds.x;
    });
  };

  // Drag the red layer halfway under the blue one, still holding it.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 150, { steps: 10 });
  // The canvas shows it where it is now, under the blue layer, and nothing
  // where it was …
  await expect.poll(() => color(270, 150)).toBe('red');
  await expect.poll(() => color(320, 150)).toBe('blue');
  await expect.poll(() => color(120, 150)).toBe('other');
  // … while the document has not moved it: nothing renders per step. The
  // design panel shows where it will land.
  expect(await redX()).toBe(100);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('250');
  await page.mouse.up();
  await expect(page.getByTestId('fig-field-x')).toHaveValue('250');
  await expect.poll(redX).toBe(250);
  await expect.poll(() => color(270, 150)).toBe('red');
  await expect.poll(() => color(120, 150)).toBe('other');
  // The move is one step.
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');
  await expect.poll(() => color(120, 150)).toBe('red');
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
});

test('lands a drag let go before it started', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [200, 200]);
  await fillSelection(page, 'FF0000');
  const xs = async () => {
    const engine = await page.evaluateHandle(() => window.figFixture.engine());
    return engine.evaluate(async (e) => {
      if (!e) return [];
      const ids = (await e.layers(0)).map((r) => r.id);
      const geometry = await e.geometry(0, ids);
      return geometry.map((g) => g.bounds.x).sort((a, b) => a - b);
    });
  };
  // ⌥-drag a copy and let go at once, all before the engine answers: the
  // press is decided, and the copy made, after the pointer is up. The copy
  // still lands, once.
  await canvas.evaluate((host) => {
    const r = host.getBoundingClientRect();
    const at = (x: number, buttons: number) => ({
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      altKey: true,
      clientX: r.left + x,
      clientY: r.top + 150,
      button: 0,
      buttons,
    });
    host.dispatchEvent(new PointerEvent('pointerdown', at(150, 1)));
    host.dispatchEvent(new PointerEvent('pointermove', at(300, 1)));
    host.dispatchEvent(new PointerEvent('pointerup', at(300, 0)));
  });
  await expect.poll(xs).toEqual([100, 250]);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('250');
  await expect.poll(() => colorAt(page, 270, 150)).toBe('red');
  await expect.poll(() => colorAt(page, 120, 150)).toBe('red');
  await expect
    .poll(() => page.evaluate(() => window.figFixture.errors()))
    .toEqual([]);
});

test('undo and redo bring back the selection', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [140, 140]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  const rows = page.getByTestId('fig-layer-row');
  // Top-most first: the copy is the first row.
  const selectedRows = () =>
    rows.evaluateAll((all) =>
      all.flatMap((r, i) =>
        r.getAttribute('aria-selected') === 'true' ? [i] : []
      )
    );
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(rows).toHaveCount(2);
  await expect.poll(selectedRows).toEqual([0]);
  // As in Figma, undoing the duplicate selects the original again …
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(1);
  await expect.poll(selectedRows).toEqual([0]);
  // … and redoing it, the copy.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows).toHaveCount(2);
  await expect.poll(selectedRows).toEqual([0]);
  // Undoing a nudge of a layer no longer selected selects it.
  await page.keyboard.press('Escape');
  await rows.nth(1).click();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect.poll(selectedRows).toEqual([]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(selectedRows).toEqual([1]);
});

test('lays out with auto layout', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [140, 140]);
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [200, 100], [260, 160]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 2');
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    '2 layers selected'
  );
  await page.keyboard.press('Shift+A');
  await expect(page.getByTestId('fig-layer-row').first()).toHaveText('Frame');
  // Side by side with the 60 px gap between them, hugging both.
  await expect(page.getByTestId('fig-sizing-w')).toHaveText('Hug');
  await expect(page.getByTestId('fig-sizing-h')).toHaveText('Hug');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('160');
  // Drop past the second square, inside the frame, to reorder. Dropping
  // outside the frame now reparents the square onto the page.
  await canvas.focus();
  await page.keyboard.press('Escape');
  await dragOnCanvas(page, [120, 120], [252, 122]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('120');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('0');
  await canvas.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame');
  const gap = page.getByTestId('fig-field-gap');
  await gap.fill('10');
  await gap.press('Enter');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('110');
  await page.getByTestId('fig-field-padding-h').fill('20');
  await page.getByTestId('fig-field-padding-h').press('Enter');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('150');
  // Fixing the width and filling it with a child.
  await page.getByTestId('fig-field-w').fill('300');
  await page.getByTestId('fig-field-w').press('Enter');
  await expect(page.getByTestId('fig-sizing-w')).toHaveText('Fixed');
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('fig-sizing-w')).toHaveText('Hug');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('150');
});

test('keeps layers pinned with constraints', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('f');
  await dragOnCanvas(page, [50, 50], [350, 250]);
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [250, 100], [300, 150]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('200');
  await page.getByTestId('fig-constraint-h').click();
  await page.getByRole('option', { name: 'Right', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame 1');
  await page.getByTestId('fig-field-w').fill('400');
  await page.getByTestId('fig-field-w').press('Enter');
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('300');
});

test('makes components, places instances, and detaches them', async ({
  page,
}) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('f');
  await dragOnCanvas(page, [50, 50], [150, 100]);
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [60, 60], [80, 80]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await canvas.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame 1');
  await page.keyboard.press('ControlOrMeta+Alt+k');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Component');
  await page.getByTestId('fig-tab-assets').click();
  await page.getByTestId('fig-asset').filter({ hasText: 'Frame 1' }).click();
  await expect(page.getByTestId('fig-design-panel')).toContainText('Instance');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    'of Frame 1'
  );
  // Layers inside the instance take overrides.
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await page.getByTestId('fig-fill-0-hex').fill('00FF00');
  await page.getByTestId('fig-fill-0-hex').press('Enter');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('00FF00');
  await canvas.focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    'of Frame 1'
  );
  await page.getByTestId('fig-tab-layers').click();
  await expect(page.getByTestId('fig-layer-row')).toHaveText([
    'Frame 1',
    'Frame 1',
  ]);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+Alt+b');
  await expect(page.getByTestId('fig-design-panel')).not.toContainText(
    'of Frame 1'
  );
});

test('adds and edits shadows', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [200, 200]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await page.getByRole('button', { name: 'Add effects' }).click();
  await page.getByTestId('fig-effect-0-settings').click();
  await expect(page.getByTestId('fig-effect-0-y')).toHaveValue('4');
  await page.getByTestId('fig-effect-0-blur').fill('20');
  await page.getByTestId('fig-effect-0-blur').press('Enter');
  await expect(page.getByTestId('fig-effect-0-blur')).toHaveValue('20');
  await page.getByTestId('fig-effect-0-type').click();
  await page.getByRole('option', { name: 'Layer blur', exact: true }).click();
  await expect(page.getByTestId('fig-effect-0-y')).toBeHidden();
});

test('resizes several layers and rotates one', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [140, 140]);
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [200, 100], [260, 160]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 2');
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    '2 layers selected'
  );
  // The selection box spans 100–260 × 100–160; its corner doubles it.
  await dragOnCanvas(page, [260, 160], [420, 220]);
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Rectangle 2' })
    .click();
  await expect(page.getByTestId('fig-field-x')).toHaveValue('300');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('120');
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Rectangle 1' })
    .click();
  await expect(page.getByTestId('fig-field-w')).toHaveValue('80');
  // Dragging just beyond a corner turns it.
  await dragOnCanvas(page, [190, 90], [200, 180]);
  await expect(page.getByTestId('fig-field-rotation')).not.toHaveValue('0');
});

test('keeps a flip apart from rotation and position', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [220, 180]);
  await canvas.focus();
  await page.keyboard.press('Shift+h');
  // As in Figma, a horizontal flip keeps the angle and the top left corner.
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue('0');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');
  const rotation = page.getByTestId('fig-field-rotation');
  await rotation.fill('90');
  await rotation.press('Enter');
  await rotation.fill('0');
  await rotation.press('Enter');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');
  // Unflipped again, a vertical flip reads as a half turn; its corners
  // still resize it.
  await canvas.focus();
  await page.keyboard.press('Shift+h');
  await page.keyboard.press('Shift+v');
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue(/^-?180$/);
  await dragOnCanvas(page, [220, 180], [260, 200]);
  await expect(page.getByTestId('fig-field-w')).toHaveValue('160');
  await expect(page.getByTestId('fig-field-h')).toHaveValue('100');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('260');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('200');
});

test('draws lines and arrows', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('l');
  await dragOnCanvas(page, [100, 100], [200, 100]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Line 1');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('100');
  await expect(page.getByTestId('fig-field-h')).toHaveValue('0');
  await canvas.focus();
  await page.keyboard.press('Shift+L');
  await dragOnCanvas(page, [100, 200], [100, 300]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Arrow');
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue('-90');
});

test('edits fills from the design panel and undoes', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [0, 0], [200, 200]);
  await page.getByTestId('fig-fill-0-hex').fill('FF0000');
  await page.getByTestId('fig-fill-0-hex').press('Enter');
  // The canvas shows the rectangle red at the view's top left.
  const red = async () => {
    const [r, g, b] = await pixel(page, 0.05, 0.05);
    return r > 240 && g < 20 && b < 20;
  };
  await expect.poll(red).toBe(true);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(red).toBe(false);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(red).toBe(true);
});

test('types text and keeps it after saving', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('t');
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.click(box.x + 120, box.y + 120);
  await expect(page.getByTestId('fig-text-editor')).toBeFocused();
  await page.keyboard.type('Hello Macro');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-text-editor')).toBeHidden();
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Text 1']);
  await expect(page.getByTestId('fig-text-content')).toHaveText('Hello Macro');
  await expect
    .poll(() => savedCount(page), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test('styles text from the design panel', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('t');
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.click(box.x + 120, box.y + 120);
  await expect(page.getByTestId('fig-text-editor')).toBeFocused();
  await page.keyboard.type('Type');
  await page.keyboard.press('Escape');
  const width = page.getByTestId('fig-field-w');
  const regular = Number(await width.inputValue());
  await page.getByTestId('fig-font-weight').click();
  await page.getByRole('option', { name: 'Bold', exact: true }).click();
  await expect
    .poll(async () => Number(await width.inputValue()))
    .toBeGreaterThan(regular);
  const lineHeight = page.getByTestId('fig-field-line-height');
  await expect(lineHeight).toHaveValue('Auto');
  await lineHeight.fill('200%');
  await lineHeight.press('Enter');
  await expect(page.getByTestId('fig-field-h')).toHaveValue('24');
  await page.getByTestId('fig-type-settings').click();
  await page.getByTestId('fig-underline').click();
  await expect(page.getByTestId('fig-underline')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByTestId('fig-text-case').click();
  await page.getByRole('option', { name: 'Uppercase', exact: true }).click();
  await expect(page.getByTestId('fig-text-content')).toHaveText('Type');
});

test('adds and renames pages', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-page-add').click();
  await expect(page.getByTestId('fig-page-rename')).toBeFocused();
  await page.keyboard.type('Flows');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fig-page')).toHaveText(['Page 1', 'Flows']);
});

test('is read-only without edit access', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('fig-tool-rectangle')).toBeHidden();
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('r');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('fig-layer-row')).toHaveText([
    'Settings',
    'Home',
  ]);
  // With nothing to nudge, arrow keys move through the layer tree.
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Settings' })
    .click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('fig-design-panel')).toContainText('Home');
});

test('stays drawn while its split resizes', async ({ page }) => {
  await open(page);
  // As when the app's sidebar opens or closes: the viewer narrows, then
  // widens again. The canvas is read right after each frame is painted.
  const painted = await page.evaluate(async () => {
    const viewer = document.querySelector<HTMLElement>(
      '[data-testid="fig-viewer"]'
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="fig-canvas"] canvas'
    );
    const host = viewer?.parentElement;
    if (!host || !canvas) return [];
    const corner = () => {
      const ctx = canvas.getContext('2d');
      const at = ctx?.getImageData(1, 1, 1, 1).data;
      return at ? [at[0], at[1], at[2]] : [];
    };
    const afterPaint = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0))
      );
    const out: number[][] = [];
    const width = host.getBoundingClientRect().width;
    for (const w of [width - 200, width - 120, width]) {
      host.style.width = `${w}px`;
      await afterPaint();
      out.push(corner());
    }
    return out;
  });
  expect(painted).toHaveLength(3);
  // Never cleared to black: the page's light background shows.
  for (const [r, g, b] of painted) expect(r + g + b).toBeGreaterThan(600);
});
