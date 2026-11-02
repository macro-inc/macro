import { type CDPSession, expect, type Page, test } from '@playwright/test';

type Point = { x: number; y: number };

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: Point[]
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, id) => ({ ...point, id })),
  });
}

/** Moves each finger from its start to its end point in even steps. */
async function drag(cdp: CDPSession, from: Point[], to: Point[]) {
  await touch(cdp, 'touchStart', from);
  const steps = 10;
  for (let step = 1; step <= steps; step++) {
    await touch(
      cdp,
      'touchMove',
      from.map((start, i) => ({
        x: start.x + ((to[i].x - start.x) * step) / steps,
        y: start.y + ((to[i].y - start.y) * step) / steps,
      }))
    );
  }
  await touch(cdp, 'touchEnd', []);
}

/** Two fingers spreading or closing from `from` to `to` px off the center. */
async function pinch(
  cdp: CDPSession,
  center: Point,
  from: number,
  to: number,
  axis: 'x' | 'y' = 'x'
) {
  const at = (offset: number): Point =>
    axis === 'x'
      ? { x: center.x + offset, y: center.y }
      : { x: center.x, y: center.y + offset };
  await drag(cdp, [at(-from), at(from)], [at(-to), at(to)]);
}

async function imageBox(page: Page) {
  const box = await page.getByAltText('Diagram').boundingBox();
  if (!box) throw new Error('Image is not rendered');
  return box;
}

async function paneCenter(page: Page): Promise<Point> {
  const box = await page.getByTestId('image-pane').boundingBox();
  if (!box) throw new Error('Image pane is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Unzoomed, the viewBox-only SVG fills the pane's width, as the browser lays
  // it out, rather than its reported 300×150 natural size.
  const pane = await page.getByTestId('image-pane').boundingBox();
  if (!pane) throw new Error('Image pane is not rendered');
  await expect
    .poll(async () => Math.round((await imageBox(page)).width))
    .toBe(Math.round(pane.width));
});

test('pinching zooms an opened image in and back out', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const center = await paneCenter(page);
  const fitted = await imageBox(page);

  await pinch(cdp, center, 30, 90);
  const zoomed = await imageBox(page);
  expect(zoomed.width).toBeGreaterThan(fitted.width * 2.5);
  expect(zoomed.height / zoomed.width).toBeCloseTo(
    fitted.height / fitted.width,
    2
  );
  // Laid out at its zoomed size rather than scaled up by a transform, which
  // WebKit renders blurry.
  const layoutWidth = await page
    .getByAltText('Diagram')
    .evaluate((image: HTMLImageElement) => image.offsetWidth);
  expect(layoutWidth).toBeCloseTo(zoomed.width, 0);

  await pinch(cdp, center, 90, 10);
  const restored = await imageBox(page);
  expect(restored.width).toBeCloseTo(fitted.width, 0);
  expect(restored.height).toBeCloseTo(fitted.height, 0);
});

test('pinching beside a small image zooms it', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const center = await paneCenter(page);
  const pane = await page.getByTestId('image-pane').boundingBox();
  if (!pane) throw new Error('Image pane is not rendered');
  const fitted = await imageBox(page);

  // Both fingers land in the empty space above and below the wide image.
  await pinch(cdp, center, fitted.height / 2 + 15, pane.height / 2 - 10, 'y');

  expect((await imageBox(page)).width).toBeGreaterThan(fitted.width * 1.5);
});

test('one finger pans only a zoomed image', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const center = await paneCenter(page);
  const left = { x: center.x - 40, y: center.y };
  const right = { x: center.x + 40, y: center.y };

  const fitted = await imageBox(page);
  await drag(cdp, [left], [right]);
  expect((await imageBox(page)).x).toBeCloseTo(fitted.x, 0);

  await pinch(cdp, center, 20, 120);
  const zoomed = await imageBox(page);
  await drag(cdp, [left], [right]);
  await expect
    .poll(async () => (await imageBox(page)).x)
    .toBeGreaterThan(zoomed.x + 30);
});

test('touches outside the image still scroll', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const list = await page.getByTestId('scroll-list').boundingBox();
  if (!list) throw new Error('Scroll list is not rendered');
  const x = list.x + list.width / 2;

  await drag(cdp, [{ x, y: list.y + 80 }], [{ x, y: list.y + 10 }]);

  await expect
    .poll(() =>
      page.getByTestId('scroll-list').evaluate((element) => element.scrollTop)
    )
    .toBeGreaterThan(0);
});

test('a cancelled pinch leaves later touches alone', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const center = await paneCenter(page);
  const list = await page.getByTestId('scroll-list').boundingBox();
  if (!list) throw new Error('Scroll list is not rendered');
  const x = list.x + list.width / 2;

  // The system takes over mid-pinch (an iOS edge gesture, say): no touchend.
  await touch(cdp, 'touchStart', [
    { x: center.x - 30, y: center.y },
    { x: center.x + 30, y: center.y },
  ]);
  await touch(cdp, 'touchMove', [
    { x: center.x - 60, y: center.y },
    { x: center.x + 60, y: center.y },
  ]);
  await touch(cdp, 'touchCancel', []);

  await drag(cdp, [{ x, y: list.y + 80 }], [{ x, y: list.y + 10 }]);

  await expect
    .poll(() =>
      page.getByTestId('scroll-list').evaluate((element) => element.scrollTop)
    )
    .toBeGreaterThan(0);
});
