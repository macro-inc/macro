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

/** One finger down at `from`, dragged to `to` in steps, and lifted. */
async function swipe(cdp: CDPSession, from: Point, to: Point) {
  await touch(cdp, 'touchStart', [from]);
  for (let step = 1; step <= 6; step++)
    await touch(cdp, 'touchMove', [
      {
        x: from.x + ((to.x - from.x) * step) / 6,
        y: from.y + ((to.y - from.y) * step) / 6,
      },
    ]);
  await touch(cdp, 'touchEnd', []);
}

const scrolled = (page: Page) =>
  page.getByTestId('document').evaluate((element) => element.scrollTop);
const camera = (page: Page) =>
  page.evaluate(() => window.canvasEmbeddedFixture.editor.getCamera());

/** The middle of the embedded canvas, on screen. */
async function embed(page: Page): Promise<Point> {
  const box = await page.getByTestId('embed').boundingBox();
  if (!box) throw new Error('The embedded canvas is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch coverage');
  await page.goto('/embedded.html');
  await expect(page.getByRole('button', { name: 'Interact' })).toBeVisible();
});

test('a swipe over the embedded canvas scrolls the document, not the canvas', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const middle = await embed(page);
  const before = await camera(page);

  await swipe(cdp, middle, { x: middle.x, y: middle.y - 150 });

  await expect.poll(() => scrolled(page)).toBeGreaterThan(80);
  expect(await camera(page)).toEqual(before);
});

test('two fingers zoom the embedded canvas and leave the document where it is', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const middle = await embed(page);

  await touch(cdp, 'touchStart', [
    { x: middle.x - 40, y: middle.y },
    { x: middle.x + 40, y: middle.y },
  ]);
  for (let step = 1; step <= 4; step++)
    await touch(cdp, 'touchMove', [
      { x: middle.x - 40 - step * 10, y: middle.y },
      { x: middle.x + 40 + step * 10, y: middle.y },
    ]);
  await touch(cdp, 'touchEnd', []);

  expect((await camera(page)).scale).toBeCloseTo(2, 1);
  expect(await scrolled(page)).toBe(0);
});

test('two fingers dragging down pan the canvas, and the document stays put', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const middle = await embed(page);
  const pair = (dy: number) => [
    { x: middle.x - 40, y: middle.y - 60 + dy },
    { x: middle.x + 40, y: middle.y - 60 + dy },
  ];

  // The direction the document scrolls in: the browser must not take it.
  await touch(cdp, 'touchStart', pair(0));
  for (let step = 1; step <= 6; step++)
    await touch(cdp, 'touchMove', pair(step * 20));
  // Read with the fingers still down: lifted this fast they flick, and the
  // canvas glides on from where they left it.
  await expect.poll(async () => (await camera(page)).y).toBeCloseTo(120, 0);
  await touch(cdp, 'touchEnd', []);

  const lifted = await camera(page);
  expect(lifted.y).toBeGreaterThanOrEqual(119.5);
  expect(lifted.scale).toBe(1);
  expect(await scrolled(page)).toBe(0);
});

test('Interact gives one finger to the canvas until Done', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const middle = await embed(page);
  const up = { x: middle.x, y: middle.y - 100 };

  await page.getByRole('button', { name: 'Interact' }).tap();
  const done = page.getByRole('button', { name: 'Done' });
  expect((await done.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await swipe(cdp, middle, up);
  expect((await camera(page)).y).toBeCloseTo(-100, 0);
  expect(await scrolled(page)).toBe(0);

  await done.tap();
  await swipe(cdp, middle, up);
  await expect.poll(() => scrolled(page)).toBeGreaterThan(50);
  expect((await camera(page)).y).toBeCloseTo(-100, 0);
});

test('a press elsewhere in the document ends the interaction', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Interact' }).tap();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

  await page.getByText('A paragraph above the canvas.').tap();

  await expect(page.getByRole('button', { name: 'Interact' })).toBeVisible();
});
