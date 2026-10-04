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
  await page.getByTestId('fig-layer-search').fill(name);
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: name })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
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
  await page.keyboard.press('Control+=');
  await expect(zoom).toHaveText(/200%/);
  await page.keyboard.press('Shift+1');
  await expect(zoom).not.toHaveText(/200%/);
});

test('exports the selection and shows the shortcuts', async ({ page }) => {
  await open(page);
  await focusLayer(page, 'Header');
  await page.getByTestId('fig-export-2x').click();
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
  await page.keyboard.press('Control+z');
  await expect.poll(red).toBe(false);
  await page.keyboard.press('Control+Shift+z');
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
  await page.getByTestId('fig-font-weight').selectOption('700');
  await expect
    .poll(async () => Number(await width.inputValue()))
    .toBeGreaterThan(regular);
  const lineHeight = page.getByTestId('fig-field-line-height');
  await expect(lineHeight).toHaveValue('Auto');
  await lineHeight.fill('200%');
  await lineHeight.press('Enter');
  await expect(page.getByTestId('fig-field-h')).toHaveValue('24');
  await page.getByTestId('fig-underline').click();
  await expect(page.getByTestId('fig-underline')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByTestId('fig-text-case').selectOption('UPPER');
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
});
