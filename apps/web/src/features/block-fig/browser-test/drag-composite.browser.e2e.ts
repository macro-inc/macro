import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('dragging the synth layer uses preview frames and remains undoable', async ({
  page,
}) => {
  const file = process.env.FIG_DRAG_FILE;
  test.skip(!file, 'Set FIG_DRAG_FILE to the synth reproduction');
  await page.goto('/?edit');
  await page.getByTestId('fig-file-input').setInputFiles(file!);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await page.getByRole('button', { name: 'Find layers', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Find layers' })
    .fill('Rectangle 70');
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: /^Rectangle 70$/ })
    .first()
    .click();
  const canvas = page.getByTestId('fig-canvas');
  await expect(page.getByTestId('fig-field-x')).toBeVisible();
  const zoom = page.getByRole('button', { name: 'Zoom and view options' });
  const initialZoom = await zoom.innerText();
  await zoom.click();
  await page
    .getByRole('menuitem', { name: 'Zoom to selection', exact: false })
    .click();
  await expect(zoom).not.toHaveText(initialZoom);
  const initialX = await page.getByTestId('fig-field-x').inputValue();
  await page.evaluate(() => {
    const engine = window.figFixture.engine()!;
    const render = engine.render.bind(engine);
    const canvas = document.querySelector('[data-testid="fig-canvas"]')!;
    canvas.setAttribute('data-preview-frames', '0');
    engine.render = (request) => {
      if (request.priority === -4_000_000)
        canvas.setAttribute(
          'data-preview-frames',
          String(Number(canvas.getAttribute('data-preview-frames')) + 1)
        );
      return render(request);
    };
  });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.65;
  const y = box.y + box.height * 0.25;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 55, y + 25, { steps: 20 });
  await expect
    .poll(() => canvas.getAttribute('data-preview-frames').then(Number))
    .toBeGreaterThan(1);
  const screenshot = test.info().outputPath('during-drag.png');
  await canvas.screenshot({ path: screenshot });
  await test.info().attach('during-drag', {
    path: screenshot,
    contentType: 'image/png',
  });
  await page.mouse.up();
  await expect(page.getByTestId('fig-field-x')).not.toHaveValue(initialX);
  await canvas.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('fig-field-x')).toHaveValue(initialX);
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('an unliftable corpus layer drags as complete frames', async ({
  page,
}) => {
  const file = process.env.FIG_DRAG_FILE;
  test.skip(!file, 'Set FIG_DRAG_FILE to the synth reproduction');
  await page.goto('/?edit');
  await page.getByTestId('fig-file-input').setInputFiles(file!);
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  const source = `/@fs${fileURLToPath(new URL('../primitives/create-tile-compositor.ts', import.meta.url))}`;
  const result = await page.evaluate(async (source) => {
    const { createTileCompositor } = await import(source);
    const engine = window.figFixture.engine()!;
    const rows = await engine.search(0, 'Rectangle 70');
    const row = rows.find((r) => r.name === 'Rectangle 70')!;
    const plan = await engine.liftPlan(0, [row.id]);
    if (!plan.refused) throw new Error('Expected a composited ancestor');
    const [geometry] = await engine.geometry(0, [row.id]);
    const bounds = geometry.bounds;
    const layout = await engine.openPage(0);
    const view = {
      camera: { x: bounds.x - 300, y: bounds.y - 200, zoom: 0.78 },
      viewport: { w: 900, h: 950 },
      dpr: 1,
    };
    let pending = 0;
    const frameTimes: number[] = [];
    let dragging = false;
    const compositor = createTileCompositor({
      engine: {
        render: (request: Parameters<typeof engine.render>[0]) => {
          pending++;
          const started = performance.now();
          const job = engine.render(request);
          return {
            id: job.id,
            promise: job.promise.finally(() => {
              pending--;
              if (dragging) frameTimes.push(performance.now() - started);
            }),
          };
        },
        cancel: (ids: number[]) => engine.cancel(ids),
      },
      onTile: () => {},
    });
    const canvas = document.createElement('canvas');
    canvas.width = view.viewport.w;
    canvas.height = view.viewport.h;
    const ctx = canvas.getContext('2d')!;
    const idle = async () => {
      while (pending) await new Promise((r) => setTimeout(r, 20));
    };
    compositor.setPage({
      page: 0,
      outline: false,
      content: layout.bounds,
      background: `rgba(${engine.summary.pages[0].background
        .slice(0, 3)
        .map((c) => c * 255)
        .join(',')},1)`,
    });
    compositor.update(view);
    await idle();
    dragging = true;
    compositor.beginInteractive();
    for (let step = 0; step < 12; step++) {
      const edit = await engine.apply(0, [
        { op: 'translate', ids: [row.id], dx: 12, dy: 6 },
      ]);
      if (edit.dirty) compositor.invalidate(edit.dirty);
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    await idle();
    compositor.draw(ctx, view);
    const lifted = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const liftedImage = canvas.toDataURL();
    dragging = false;
    const rendered = await engine.render({
      page: 0,
      x: view.camera.x,
      y: view.camera.y,
      scale: 0.78,
      width: canvas.width,
      height: canvas.height,
      outline: false,
      priority: 0,
    }).promise;
    ctx.drawImage(rendered!.bitmap, 0, 0);
    rendered!.bitmap.close();
    const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let mismatched = 0;
    for (let i = 0; i < actual.length; i += 4)
      if (
        Math.max(
          ...[0, 1, 2].map((c) => Math.abs(actual[i + c] - lifted[i + c]))
        ) > 32
      )
        mismatched++;
    const committedImage = canvas.toDataURL();
    compositor.endInteractive();
    await idle();
    compositor.draw(ctx, view);
    const finalPixels = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    let finalMismatch = 0;
    for (let i = 0; i < actual.length; i += 4)
      if (
        Math.max(
          ...[0, 1, 2].map((c) => Math.abs(actual[i + c] - finalPixels[i + c]))
        ) > 32
      )
        finalMismatch++;
    compositor.dispose();
    return {
      mismatched,
      finalMismatch,
      pixels: canvas.width * canvas.height,
      frameTimes,
      liftedImage,
      committedImage,
    };
  }, source);
  await test.info().attach('lifted', {
    body: Buffer.from(result.liftedImage.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  await test.info().attach('committed', {
    body: Buffer.from(result.committedImage.split(',')[1], 'base64'),
    contentType: 'image/png',
  });
  console.info(
    'drag-composite',
    JSON.stringify({
      mismatched: result.mismatched,
      pixels: result.pixels,
      frameTimes: result.frameTimes,
    })
  );
  // The moving preview trades fine edge detail for latency, but must not
  // introduce the large rectangular corruption seen with mixed tile ages.
  expect(result.mismatched / result.pixels).toBeLessThan(0.04);
  expect(result.finalMismatch / result.pixels).toBeLessThan(0.01);
});
