import { expect, test } from '@playwright/test';

test('profiles a local design without changing its contents', async ({
  page,
}) => {
  const input = process.env.FIG_PERF_FILE;
  test.skip(!input, 'Set FIG_PERF_FILE to benchmark a local .fig');
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const drawn = new WeakSet<HTMLCanvasElement>();
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      ...args: unknown[]
    ) {
      Reflect.apply(drawImage, this, args);
      if (
        !drawn.has(this.canvas) &&
        this.canvas ===
          document.querySelector('[data-testid="fig-canvas"] canvas')
      ) {
        drawn.add(this.canvas);
        // A paint opportunity after an actual tile, not just the viewer shell.
        requestAnimationFrame(() =>
          performance.mark('fig-test:first-tile-frame')
        );
      }
    };
  });
  await page.goto('/?realFonts');
  for (let run = 0; run < 2; run++) {
    await page.getByTestId('fig-file-input').setInputFiles([]);
    const previous = await page.evaluateHandle(() =>
      window.figFixture.engine()
    );
    const started = Date.now();
    await page.evaluate(() => {
      performance.clearMarks('fig-test:first-tile-frame');
      performance.mark('fig-test:upload-start');
    });
    await page.getByTestId('fig-file-input').setInputFiles(input!);
    await page.waitForFunction(
      (old) => window.figFixture.engine() && window.figFixture.engine() !== old,
      previous,
      { timeout: 120_000 }
    );
    await previous.dispose();
    await expect(page.getByTestId('fig-viewer')).toBeVisible({
      timeout: 120_000,
    });
    const visibleMs = Date.now() - started;
    await page.waitForFunction(
      () => performance.getEntriesByName('fig-test:first-tile-frame').length,
      undefined,
      { timeout: 120_000 }
    );
    const firstTileFrameMs = await page.evaluate(() => {
      const tile = performance.getEntriesByName('fig-test:first-tile-frame')[0];
      const starts = performance.getEntriesByName('fig-test:upload-start');
      return tile.startTime - starts[starts.length - 1].startTime;
    });
    const measurements = await page.evaluate(async () => {
      const engine = window.figFixture.engine();
      if (!engine) throw new Error('No engine');
      const layout = await engine.openPage(0);
      const bounds = layout.bounds;
      const scale = Math.min(512 / Math.max(bounds.w, bounds.h), 1);
      const started = performance.now();
      const pending = engine.render({
        page: 0,
        x: bounds.x,
        y: bounds.y,
        scale,
        width: 512,
        height: 512,
        outline: false,
        priority: 0,
      });
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const before = performance.now();
        await engine.hitTest(
          0,
          bounds.x + (bounds.w * i) / 20,
          bounds.y + bounds.h / 2,
          1
        );
        samples.push(performance.now() - before);
      }
      const tile = await pending.promise;
      const renderWallMs = performance.now() - started;
      tile?.bitmap.close();
      samples.sort((a, b) => a - b);
      return {
        nodes: engine.summary.nodeCount,
        renderWallMs,
        rasterMs: tile?.millis,
        hitTestP95Ms: samples[18],
        errors: window.figFixture.errors(),
      };
    });
    console.info(
      '[fig-corpus]',
      JSON.stringify({
        input,
        run,
        visibleMs,
        firstTileFrameMs,
        ...measurements,
      })
    );
    expect(measurements.errors).toEqual([]);
  }
});

test('reuses compiled wasm when reopening a design', async ({ page }) => {
  const wasmRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('fig_engine_bg'))
      wasmRequests.push(request.url());
  });
  await page.goto('/?file=showcase.fig');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  const timings = await page.evaluate(async () => {
    const source = window.figFixture.engine();
    if (!source) throw new Error('No engine');
    const Engine =
      source.constructor as typeof import('@core/fig-engine/client').FigEngine;
    const blank = await Engine.blank('Cache test');
    const empty = await Engine.open(blank.buffer);
    empty.close();
    const bytes = await source.save();
    const started = performance.now();
    const reopened = await Engine.open(bytes.buffer as ArrayBuffer);
    try {
      const opened = performance.now() - started;
      const layout = await reopened.openPage(0);
      const b = layout.bounds;
      const rendering = performance.now();
      const tile = await reopened.render({
        page: 0,
        x: b?.x ?? 0,
        y: b?.y ?? 0,
        width: 512,
        height: 512,
        scale: 1,
        outline: false,
        priority: 0,
      }).promise;
      const raster = performance.now() - rendering;
      tile?.bitmap.close();
      return {
        reopenMs: opened,
        tileMs: raster,
        nodes: reopened.summary.nodeCount,
      };
    } finally {
      reopened.close();
    }
  });
  console.info('[fig-performance]', JSON.stringify(timings));
  expect(wasmRequests).toHaveLength(1);
});

test('hover repaints the overlay without recompositing the page', async ({
  page,
}) => {
  await page.goto('/?file=showcase.fig');
  const canvas = page.getByTestId('fig-canvas');
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Observe actual paint activity: a fixed delay can overlap a late tile
  // or font load on a busy machine and count it as a hover repaint.
  await canvas
    .locator('canvas')
    .first()
    .evaluate((element) => {
      const tile = element as HTMLCanvasElement;
      const context = tile.getContext('2d');
      if (!context) throw new Error('No canvas context');
      const fill = context.fillRect.bind(context);
      tile.dataset.pagePaints = '0';
      tile.dataset.lastPagePaint = String(performance.now());
      context.fillRect = (...args) => {
        tile.dataset.pagePaints = String(Number(tile.dataset.pagePaints) + 1);
        tile.dataset.lastPagePaint = String(performance.now());
        fill(...args);
      };
    });
  await page.waitForFunction(() => {
    const tile = document.querySelector<HTMLCanvasElement>(
      '[data-testid="fig-canvas"] canvas'
    );
    return (
      tile && performance.now() - Number(tile.dataset.lastPagePaint) >= 1000
    );
  });
  await canvas
    .locator('canvas')
    .first()
    .evaluate((element) => {
      (element as HTMLCanvasElement).dataset.pagePaints = '0';
    });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas bounds');
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 20,
  });
  await page.waitForTimeout(200);
  await expect(canvas.locator('canvas').first()).toHaveAttribute(
    'data-page-paints',
    '0'
  );
});
