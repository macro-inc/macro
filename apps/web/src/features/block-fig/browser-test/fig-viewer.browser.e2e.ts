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
