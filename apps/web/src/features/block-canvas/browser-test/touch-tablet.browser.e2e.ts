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

const camera = (page: Page) =>
  page.evaluate(() => window.canvasTouchFixture.editor.getCamera());

/** The centre of the fixture's filled rectangle, on screen. */
async function filledShape(page: Page): Promise<Point> {
  const box = await page.locator('[data-graphics-item="filled"]').boundingBox();
  if (!box) throw new Error('The filled rectangle is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/touch.html');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();
});

test('an upright tablet keeps zoom, history and the tools on one row', async ({
  page,
}) => {
  const tools = page.getByLabel('Drawing tools');
  const [toolsBox, zoom, undo] = await Promise.all([
    tools.boundingBox(),
    page.getByRole('button', { name: 'Zoom options' }).boundingBox(),
    page.getByRole('button', { name: 'Undo' }).boundingBox(),
  ]);
  if (!toolsBox || !zoom || !undo) throw new Error('The bar is not rendered');
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(zoom) - middle(toolsBox))).toBeLessThan(4);
  expect(Math.abs(middle(undo) - middle(toolsBox))).toBeLessThan(4);
});

test('a tablet on its side has room for every tool', async ({ page }) => {
  const tools = page.getByLabel('Drawing tools');
  // Upright, the shapes share a button and so do the lines.
  await expect(tools.getByRole('button', { name: 'Ellipse tool' })).toHaveCount(
    0
  );

  await page.setViewportSize({ width: 1112, height: 834 });

  for (const name of ['Rectangle', 'Ellipse', 'Arrow', 'Line', 'Connector'])
    await expect(
      tools.getByRole('button', { name: `${name} tool` })
    ).toBeVisible();
});

test('a selection opens the inspector beside the canvas, and Style folds it away', async ({
  page,
}) => {
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);

  const panel = page.getByRole('complementary', { name: 'Canvas inspector' });
  await expect(panel).toBeVisible();
  const [panelBox, bar] = await Promise.all([
    panel.boundingBox(),
    page.getByLabel('Drawing tools').boundingBox(),
  ]);
  if (!panelBox || !bar) throw new Error('The panel is not rendered');
  // Beside the scene, not over the bottom chrome.
  expect(panelBox.x).toBeGreaterThan(shape.x + 100);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(bar.y);

  const style = page
    .getByLabel('Selection actions')
    .getByRole('button', { name: 'Style' });
  await expect(style).toHaveAttribute('aria-expanded', 'true');
  await style.tap();
  await expect(panel).toHaveCount(0);
  await style.tap();
  await expect(panel).toBeVisible();
});

test('Zoom to fit keeps the scene beside the open inspector', async ({
  page,
}) => {
  const shape = await filledShape(page);
  await page.touchscreen.tap(shape.x, shape.y);
  const panel = page.getByRole('complementary', { name: 'Canvas inspector' });
  await expect(panel).toBeVisible();

  await page.getByRole('button', { name: 'Zoom options' }).tap();
  await page.getByRole('button', { name: 'Zoom to fit' }).tap();

  const panelLeft = (await panel.boundingBox())?.x ?? 0;
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll('[data-graphics-item]')].map(
            (item) => item.getBoundingClientRect().right
          )
        )
      )
    )
    .toBeLessThanOrEqual(panelLeft - 24 + 4);
});

test('two fingers zoom the canvas on a tablet too', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);

  await touch(cdp, 'touchStart', [
    { x: 300, y: 500 },
    { x: 400, y: 500 },
  ]);
  for (let step = 1; step <= 5; step++)
    await touch(cdp, 'touchMove', [
      { x: 300 - step * 10, y: 500 },
      { x: 400 + step * 10, y: 500 },
    ]);
  await touch(cdp, 'touchEnd', []);

  await expect.poll(async () => (await camera(page)).scale).toBeCloseTo(2, 1);
});
