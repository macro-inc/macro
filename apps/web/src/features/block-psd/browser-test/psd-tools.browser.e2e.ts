import { expect, type Locator, type Page, test } from '@playwright/test';

// Crop, a filter with its preview, and painting a layer mask, on a new
// 800 × 600 document in the real editor.

async function open(page: Page) {
  await page.goto('/?new&size=800x600');
  await expect(page.getByTestId('psd-canvas')).toBeVisible();
  await expect.poll(() => pixel(canvas(page), 0.5, 0.5)).toEqual(WHITE);
  await canvas(page).click({ position: { x: 4, y: 4 } });
}

const canvas = (page: Page) => page.getByTestId('psd-canvas');

function pixel(view: Locator, fx: number, fy: number) {
  return view
    .locator('canvas')
    .first()
    .evaluate(
      (node, [x, y]) => {
        const c = node as HTMLCanvasElement;
        const at = c
          .getContext('2d')
          ?.getImageData(
            Math.floor(c.width * x),
            Math.floor(c.height * y),
            1,
            1
          ).data;
        return at ? [at[0], at[1], at[2]] : [0, 0, 0];
      },
      [fx, fy]
    );
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1]
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 8,
  });
  await page.mouse.up();
}

/** A new layer with a black square filled in the middle of the canvas. */
async function blackSquare(page: Page) {
  await page.getByTestId('psd-new-layer').click();
  await page.keyboard.press('m');
  await drag(page, [0.4, 0.4], [0.6, 0.6]);
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('Control+d');
  await expect.poll(() => pixel(canvas(page), 0.5, 0.5)).toEqual(BLACK);
}

const documentSize = (page: Page) =>
  page.evaluate(async () => {
    const s = await window.psdFixture.engine()?.currentSummary();
    return s ? [s.width, s.height] : [];
  });

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

test('crops to a drawn box', async ({ page }) => {
  await open(page);
  await page.keyboard.press('c');
  await drag(page, [0.3, 0.3], [0.6, 0.7]);
  await expect(page.getByTestId('psd-options-commit')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => documentSize(page)).not.toEqual([800, 600]);
  const [width, height] = await documentSize(page);
  expect(width).toBeLessThan(800);
  expect(height).toBeLessThan(600);
  await expect(page.getByTestId('psd-status')).toContainText(
    `${width} × ${height} px`
  );
  // Undo brings the whole canvas back.
  await page.keyboard.press('Control+z');
  await expect.poll(() => documentSize(page)).toEqual([800, 600]);
});

test('previews a filter, and applies it as one step', async ({ page }) => {
  await open(page);
  await blackSquare(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  // Just outside the square's right edge.
  const edge = (0.6 * box.width + 3) / box.width;

  await page.getByTestId('psd-menu-filter').click();
  await page.getByTestId('psd-menu-filter-gaussianBlur').click();
  await expect(page.getByTestId('psd-filter-dialog')).toBeVisible();
  // The canvas previews the blur: the edge darkens.
  await expect
    .poll(async () => (await pixel(canvas(page), edge, 0.5))[0])
    .toBeLessThan(250);
  await page.getByTestId('psd-filter-dialog-cancel').click();
  await expect.poll(() => pixel(canvas(page), edge, 0.5)).toEqual(WHITE);

  await page.getByTestId('psd-menu-filter').click();
  await page.getByTestId('psd-menu-filter-gaussianBlur').click();
  await page.getByTestId('psd-filter-dialog-ok').click();
  await expect(page.getByTestId('psd-filter-dialog')).toBeHidden();
  await expect
    .poll(async () => (await pixel(canvas(page), edge, 0.5))[0])
    .toBeLessThan(250);
  await page.keyboard.press('Control+z');
  await expect.poll(() => pixel(canvas(page), edge, 0.5)).toEqual(WHITE);
});

test('paints on a layer mask', async ({ page }) => {
  await open(page);
  await blackSquare(page);
  await page.getByTestId('psd-add-mask').click();
  await expect(page.getByTestId('psd-layer-mask')).toBeVisible();
  // Black on the mask hides the square there.
  await page.keyboard.press('d');
  await page.keyboard.press('b');
  await drag(page, [0.45, 0.5], [0.55, 0.5]);
  await expect.poll(() => pixel(canvas(page), 0.5, 0.5)).toEqual(WHITE);
  // The rest of the square still shows.
  expect(await pixel(canvas(page), 0.5, 0.42)).toEqual(BLACK);
});
