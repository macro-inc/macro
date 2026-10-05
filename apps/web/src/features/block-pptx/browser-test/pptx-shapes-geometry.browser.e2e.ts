import type { GeometryPath, ShapeGeometryInfo } from '@core/pptx-engine/types';
import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

interface Box {
  preset: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function outline(page: Page) {
  return page.evaluate(async () => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return engine.outline();
  });
}

/**
 * Adds a blank slide holding `shapes` (as an edit made elsewhere, which the
 * editor reloads) and shows it; returns its index and the shapes' ids.
 */
async function slideWith(page: Page, shapes: Box[]) {
  const layouts = (await outline(page)).layouts;
  const layout = (
    layouts.find((l) => l.name === 'Blank') ??
    layouts.find((l) => l.name === 'Title Only')
  )?.name;
  const added = await page.evaluate(
    (layout) => window.pptxFixture.externalEdit([{ op: 'addSlide', layout }]),
    layout
  );
  const slide = added.created[0].slide;
  const result = await page.evaluate(
    ({ slide, shapes }) =>
      window.pptxFixture.externalEdit(
        shapes.map((s) => ({
          op: 'addShape' as const,
          slide,
          shape: { kind: 'shape' as const, preset: s.preset, text: '' },
          x: s.x,
          y: s.y,
          w: s.w,
          h: s.h,
        }))
      ),
    { slide, shapes }
  );
  const ids = result.created.map((c) => c.shape as number);
  await expect
    .poll(async () => {
      const deck = await outline(page);
      return deck.slides.find((s) => s.id === slide)?.shapes.length ?? 0;
    })
    .toBeGreaterThanOrEqual(shapes.length);
  const index = (await outline(page)).slides.findIndex((s) => s.id === slide);
  await page.getByTestId('pptx-thumbnail').nth(index).click();
  await expect(page.getByTestId('pptx-thumbnail').nth(index)).toHaveAttribute(
    'aria-current',
    'true'
  );
  return { slide, index, ids };
}

async function slideShapes(page: Page, index: number) {
  return (await outline(page)).slides[index].shapes;
}

function geometry(page: Page, index: number, shape: number) {
  return page.evaluate(
    async ({ index, shape }) => {
      const engine = window.pptxFixture.engine();
      if (!engine?.geometryPaths) throw new Error('No geometry reader.');
      return engine.geometryPaths(index, shape);
    },
    { index, shape }
  );
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const scale = box.width / (await outline(page)).width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** Every vertex of an outline in slide points. */
function vertices(info: ShapeGeometryInfo) {
  const [a, b, c, d, e, f] = info.transform;
  const at = (x: number, y: number) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  });
  return info.paths.flatMap((p: GeometryPath) =>
    p.commands.flatMap((cmd) =>
      cmd.cmd === 'moveTo' ||
      cmd.cmd === 'lineTo' ||
      cmd.cmd === 'cubicBezTo' ||
      cmd.cmd === 'quadBezTo'
        ? [at(cmd.x, cmd.y)]
        : []
    )
  );
}

/** The polygon area of the vertices of each sub-path (straight outlines). */
function polygonArea(info: ShapeGeometryInfo) {
  const [a, b, c, d, e, f] = info.transform;
  let total = 0;
  for (const p of info.paths) {
    let ring: { x: number; y: number }[] = [];
    const flush = () => {
      let s = 0;
      for (let i = 0; i < ring.length; i++) {
        const p0 = ring[i];
        const p1 = ring[(i + 1) % ring.length];
        s += p0.x * p1.y - p1.x * p0.y;
      }
      total += s / 2;
      ring = [];
    };
    for (const cmd of p.commands) {
      if (cmd.cmd === 'moveTo' && ring.length) flush();
      if (cmd.cmd === 'moveTo' || cmd.cmd === 'lineTo')
        ring.push({
          x: a * cmd.x + c * cmd.y + e,
          y: b * cmd.x + d * cmd.y + f,
        });
    }
    if (ring.length) flush();
  }
  return Math.abs(total);
}

async function selectAt(page: Page, x: number, y: number, add = false) {
  const at = await screen(page, x, y);
  if (add) await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  if (add) await page.keyboard.up('Shift');
}

async function enterEditPoints(page: Page) {
  await page.getByTestId('pptx-tab-shape-format').click();
  await page.getByTestId('pptx-edit-shape').click();
  await page.getByTestId('pptx-edit-points').click();
  await expect(page.getByTestId('pptx-edit-points-overlay')).toBeVisible();
}

async function dragSlide(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const a = await screen(page, from.x, from.y);
  const b = await screen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

const near = (a: number, b: number, tol = 0.6) => Math.abs(a - b) <= tol;

test('Edit Points drags vertices, adds and deletes points, and converts them', async ({
  page,
}) => {
  await open(page);
  const { index, ids } = await slideWith(page, [
    { preset: 'rect', x: 200, y: 150, w: 200, h: 150 },
  ]);
  const id = ids[0];
  await selectAt(page, 300, 225);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  await enterEditPoints(page);
  const points = page.getByTestId('pptx-edit-point');
  await expect(points).toHaveCount(4);
  // The selection handles give way to the outline.
  await expect(page.getByTestId('pptx-handle-se')).toHaveCount(0);

  // Select a vertex: its handles show, a third of the way along its sides.
  const corner = await screen(page, 400, 300);
  await page.mouse.click(corner.x, corner.y);
  await expect(page.getByTestId('pptx-edit-points-handle-in')).toBeVisible();
  await expect(page.getByTestId('pptx-edit-points-handle-out')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('edit-points.png'),
    clip: await (async () => {
      const a = await screen(page, 150, 100);
      const b = await screen(page, 450, 350);
      return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    })(),
  });

  // Drag the bottom-right vertex: the box grows to the new outline.
  await dragSlide(page, { x: 400, y: 300 }, { x: 440, y: 330 });
  await expect
    .poll(async () => (await slideShapes(page, index))[0])
    .toMatchObject({ x: 200, y: 150 });
  let s = (await slideShapes(page, index))[0];
  expect(near(s.w, 240, 1.5) && near(s.h, 180, 1.5)).toBe(true);
  let info = await geometry(page, index, id);
  expect(info?.preset).toBeUndefined();
  expect(
    vertices(info as ShapeGeometryInfo).some(
      (v) => near(v.x, 440, 1.5) && near(v.y, 330, 1.5)
    )
  ).toBe(true);
  await expect(points).toHaveCount(4);

  // Ctrl+click the top side adds a point; Ctrl+click it again deletes it.
  const top = await screen(page, 300, 150);
  await page.keyboard.down('Control');
  await page.mouse.click(top.x, top.y);
  await page.keyboard.up('Control');
  await expect(points).toHaveCount(5);
  info = await geometry(page, index, id);
  expect(vertices(info as ShapeGeometryInfo)).toHaveLength(5);
  await page.keyboard.down('Control');
  await page.mouse.click(top.x, top.y);
  await page.keyboard.up('Control');
  await expect(points).toHaveCount(4);

  // Dragging a side bends it into a curve.
  await dragSlide(page, { x: 200, y: 225 }, { x: 170, y: 225 });
  await expect
    .poll(async () =>
      (await geometry(page, index, id))?.paths[0].commands.some(
        (c) => c.cmd === 'cubicBezTo'
      )
    )
    .toBe(true);

  // Right-click a vertex: Smooth Point curves both of its sides.
  const vertex = await screen(page, 200, 150);
  await page.mouse.click(vertex.x, vertex.y, { button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Smooth Point' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect
    .poll(async () => {
      const cmds = (await geometry(page, index, id))?.paths[0].commands ?? [];
      return cmds.filter((c) => c.cmd === 'cubicBezTo').length;
    })
    .toBeGreaterThanOrEqual(2);

  // Each gesture is one undo step.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => {
      const cmds = (await geometry(page, index, id))?.paths[0].commands ?? [];
      return cmds.filter((c) => c.cmd === 'cubicBezTo').length;
    })
    .toBe(1);

  // Esc leaves Edit Points, back to the selected shape.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-edit-points-overlay')).toHaveCount(0);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  s = (await slideShapes(page, index))[0];
  expect(s.id).toBe(id);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('Edit Points on a rotated shape follows the pointer, and the menu exits', async ({
  page,
}) => {
  await open(page);
  const { index, ids } = await slideWith(page, [
    { preset: 'triangle', x: 300, y: 150, w: 160, h: 120 },
  ]);
  const id = ids[0];
  await page.evaluate(
    async ({ index, id }) => {
      // Turn and flip it (an edit made elsewhere, which the editor reloads).
      const deck = await window.pptxFixture.engine()?.outline();
      const slide = deck?.slides[index].id ?? 0;
      await window.pptxFixture.externalEdit([
        { op: 'setTransform', slide, shape: id, rotation: 30, flipH: true },
      ]);
    },
    { index, id }
  );
  await expect
    .poll(async () => (await slideShapes(page, index))[0]?.rotation)
    .toBe(30);
  await page.getByTestId('pptx-thumbnail').nth(index).click();
  await selectAt(page, 380, 215);
  // Right-click the shape ▸ Edit Points.
  const middle = await screen(page, 380, 215);
  await page.mouse.click(middle.x, middle.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit Points' }).click();
  await expect(page.getByTestId('pptx-edit-point')).toHaveCount(3);

  // Drag the apex (wherever rotation put it) 30 pt to the right.
  const before = vertices(
    (await geometry(page, index, id)) as ShapeGeometryInfo
  );
  const apex = before[0];
  await dragSlide(page, apex, { x: apex.x + 30, y: apex.y });
  await expect
    .poll(async () => {
      const now = vertices(
        (await geometry(page, index, id)) as ShapeGeometryInfo
      );
      return now.some(
        (v) => near(v.x, apex.x + 30, 1.5) && near(v.y, apex.y, 1.5)
      );
    })
    .toBe(true);
  // The other corners stayed where they were on the slide.
  const after = vertices(
    (await geometry(page, index, id)) as ShapeGeometryInfo
  );
  for (const v of before.slice(1)) {
    expect(after.some((w) => near(w.x, v.x, 1) && near(w.y, v.y, 1))).toBe(
      true
    );
  }
  expect((await slideShapes(page, index))[0]).toMatchObject({
    rotation: 30,
    flipH: true,
  });

  // Right-click empty slide ▸ Exit Edit Points.
  const empty = await screen(page, 60, 480);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Exit Edit Points' }).click();
  await expect(page.getByTestId('pptx-edit-points-overlay')).toHaveCount(0);
});

test('Merge Shapes: Union, Subtract, and Fragment of overlapping shapes', async ({
  page,
}) => {
  await open(page);
  const { index, ids } = await slideWith(page, [
    { preset: 'rect', x: 100, y: 100, w: 200, h: 150 },
    { preset: 'rect', x: 200, y: 175, w: 200, h: 150 },
  ]);
  const [first, second] = ids;
  const pick = async () => {
    await selectAt(page, 120, 120);
    await selectAt(page, 380, 300, true);
    await expect(page.getByTestId('pptx-selection-outline')).toHaveCount(2);
    await page.getByTestId('pptx-tab-shape-format').click();
  };
  const merge = async (mode: string) => {
    await page.getByTestId('pptx-merge-shapes').click();
    await page.getByTestId(`pptx-merge-${mode}`).click();
  };

  // One shape selected: Merge Shapes is off.
  await selectAt(page, 120, 120);
  await page.getByTestId('pptx-tab-shape-format').click();
  await expect(page.getByTestId('pptx-merge-shapes')).toBeDisabled();

  // Union: one L-shaped outline in the first shape's place and look.
  await pick();
  await page.screenshot({
    path: test.info().outputPath('merge-before.png'),
  });
  await merge('union');
  await expect
    .poll(async () => (await slideShapes(page, index)).length)
    .toBe(1);
  let shapes = await slideShapes(page, index);
  expect(shapes[0].id).toBe(first);
  expect(shapes[0]).toMatchObject({ x: 100, y: 100, w: 300, h: 225 });
  let info = (await geometry(page, index, first)) as ShapeGeometryInfo;
  expect(vertices(info)).toHaveLength(8);
  expect(near(polygonArea(info), 2 * 200 * 150 - 100 * 75, 2)).toBe(true);
  // The result is selected.
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('merge-union.png'),
  });

  // Undo brings both back.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await slideShapes(page, index)).length)
    .toBe(2);

  // Subtract: the first without the second.
  await pick();
  await merge('subtract');
  await expect
    .poll(async () => (await slideShapes(page, index)).length)
    .toBe(1);
  shapes = await slideShapes(page, index);
  expect(shapes[0]).toMatchObject({ x: 100, y: 100, w: 200, h: 150 });
  info = (await geometry(page, index, first)) as ShapeGeometryInfo;
  expect(vertices(info)).toHaveLength(6);
  expect(near(polygonArea(info), 200 * 150 - 100 * 75, 2)).toBe(true);
  expect(shapes.some((s) => s.id === second)).toBe(false);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await slideShapes(page, index)).length)
    .toBe(2);

  // Fragment: three pieces, all selected, tiling the union.
  await pick();
  await merge('fragment');
  await expect
    .poll(async () => (await slideShapes(page, index)).length)
    .toBe(3);
  await expect(page.getByTestId('pptx-selection-outline')).toHaveCount(3);
  shapes = await slideShapes(page, index);
  let total = 0;
  for (const s of shapes)
    total += polygonArea(
      (await geometry(page, index, s.id)) as ShapeGeometryInfo
    );
  expect(near(total, 2 * 200 * 150 - 100 * 75, 3)).toBe(true);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});
