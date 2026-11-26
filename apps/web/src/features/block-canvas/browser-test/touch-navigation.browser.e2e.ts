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

/** Moves each finger from its start to its end point in even steps. */
async function move(cdp: CDPSession, from: Point[], to: Point[]) {
  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    await touch(
      cdp,
      'touchMove',
      from.map((start, index) => ({
        x: start.x + ((to[index]!.x - start.x) * step) / steps,
        y: start.y + ((to[index]!.y - start.y) * step) / steps,
      }))
    );
  }
}

const alice = (page: Page) =>
  page.evaluate(() => {
    const { editor } = window.canvasFixture.people.get('Alice')!;
    const { selectedIds, canUndo } = editor.getSession();
    return {
      camera: editor.getCamera(),
      items: Object.keys(editor.document.items).length,
      selectedIds,
      canUndo,
    };
  });

/** A point on Alice's canvas, away from the fixture's one rectangle. */
async function emptyCanvasPoint(page: Page): Promise<Point> {
  const canvas = page
    .locator('[data-person="Alice"]')
    .getByLabel('Graphics canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 320 };
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch input coverage');
  await page.goto('/');
});

for (const tool of ['select', 'pan', 'rectangle', 'pencil'] as const) {
  test(`two fingers zoom around their midpoint with the ${tool} tool`, async ({
    page,
  }) => {
    const center = await emptyCanvasPoint(page);
    await page.evaluate((next) => window.canvasFixture.setTool(next), tool);
    const before = await alice(page);
    const cdp = await page.context().newCDPSession(page);
    const left = { x: center.x - 20, y: center.y };
    const right = { x: center.x + 20, y: center.y };

    // The first finger lands and moves alone before the second arrives, so the
    // tool has already started a marquee, a pan, a shape or a stroke.
    await touch(cdp, 'touchStart', [left]);
    await touch(cdp, 'touchMove', [{ x: left.x, y: left.y + 6 }]);
    await touch(cdp, 'touchStart', [{ x: left.x, y: left.y + 6 }, right]);
    await move(
      cdp,
      [{ x: left.x, y: left.y + 6 }, right],
      [
        { x: center.x - 50, y: center.y },
        { x: center.x + 50, y: center.y },
      ]
    );
    await touch(cdp, 'touchEnd', []);

    const after = await alice(page);
    expect(after.camera.scale).toBeGreaterThan(before.camera.scale * 2);
    expect(after.items).toBe(before.items);
    expect(after.selectedIds).toEqual(before.selectedIds);
    expect(after.canUndo).toBe(false);
  });
}

test('two fingers moving together pan the canvas', async ({ page }) => {
  const center = await emptyCanvasPoint(page);
  const before = await alice(page);
  const cdp = await page.context().newCDPSession(page);
  const from = [
    { x: center.x - 20, y: center.y },
    { x: center.x + 20, y: center.y },
  ];
  const to = from.map((point) => ({ x: point.x + 30, y: point.y - 60 }));

  await touch(cdp, 'touchStart', from);
  await move(cdp, from, to);

  // Read with the fingers still down: lifting them may glide further. The
  // browser delivers the last move with its next frame.
  await expect
    .poll(async () => {
      const { camera } = await alice(page);
      return {
        x: Math.round(camera.x - before.camera.x),
        y: Math.round(camera.y - before.camera.y),
        scale: Math.round((camera.scale / before.camera.scale) * 1000) / 1000,
      };
    })
    .toEqual({ x: 30, y: -60, scale: 1 });
  await touch(cdp, 'touchEnd', []);
});

test('a two-finger flick keeps gliding after release', async ({ page }) => {
  const center = await emptyCanvasPoint(page);
  const before = (await alice(page)).camera;
  const cdp = await page.context().newCDPSession(page);
  const from = [
    { x: center.x - 20, y: center.y },
    { x: center.x + 20, y: center.y },
  ];
  const to = from.map((point) => ({ x: point.x, y: point.y - 120 }));

  await touch(cdp, 'touchStart', from);
  await move(cdp, from, to);
  await touch(cdp, 'touchEnd', []);

  // The fingers travelled 120px; the glide carries the camera past that.
  await expect
    .poll(async () => (await alice(page)).camera.y)
    .toBeLessThan(before.y - 130);
});
