import type { TextLayoutInfo } from '@core/pptx-engine/types';
import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

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

function textLayout(page: Page, index: number, shape: number) {
  return page.evaluate(
    ([index, shape]) => window.pptxFixture.engine()?.textLayout(index, shape),
    [index, shape] as const
  );
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** A layout point of a text layout in slide space. */
function slidePoint(layout: TextLayoutInfo, x: number, y: number) {
  const [a, b, c, d, e, f] = layout.transform;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** The caret's ends in slide points. */
async function caret(page: Page) {
  const line = page.getByTestId('pptx-caret');
  await expect(line).toBeAttached();
  const n = async (name: string) => Number(await line.getAttribute(name));
  return {
    x1: await n('x1'),
    y1: await n('y1'),
    x2: await n('x2'),
    y2: await n('y2'),
  };
}

async function newTextBox(page: Page, text: string) {
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-textbox').click();
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.type(text);
  const shapes = (await outline(page)).slides[0].shapes;
  return shapes[shapes.length - 1];
}

test('turns a text box vertical, types into it, and moves through it', async ({
  page,
}) => {
  await open(page);
  const box = await newTextBox(page, 'Quarterly');
  await page.getByTestId('pptx-tab-home').click();
  await page.getByTestId('pptx-text-direction').click();
  await expect(
    page.getByTestId('pptx-text-direction-horz').getByText('Horizontal')
  ).toBeVisible();
  await page.getByTestId('pptx-text-direction-vert').click();
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.id === box.id)
          ?.textDirection
    )
    .toBe('vert');
  // The text box turned with its text: it is now taller than wide.
  const turned = (await outline(page)).slides[0].shapes.find(
    (s) => s.id === box.id
  );
  expect(turned && turned.h > turned.w).toBe(true);

  // The caret layout is rotated a quarter turn: lines run down the slide.
  const layout = await textLayout(page, 0, box.id);
  if (!layout) throw new Error('No text layout.');
  expect(layout.transform[1]).toBeCloseTo(1);
  expect(layout.transform[2]).toBeCloseTo(-1);
  // The caret (still at the end) lies across the line.
  let c = await caret(page);
  expect(c.y1).toBeCloseTo(c.y2, 1);
  expect(Math.abs(c.x1 - c.x2)).toBeGreaterThan(5);

  // Typing continues down the line.
  await page.keyboard.type(' up');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.id === box.id)
          ?.paragraphs?.[0].text
    )
    .toBe('Quarterly up');
  const end = await caret(page);
  expect(end.y1).toBeGreaterThan(c.y1);

  // Up moves back a character (up the line), Down forward again.
  await page.keyboard.press('ArrowUp');
  c = await caret(page);
  expect(c.y1).toBeLessThan(end.y1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await caret(page)).y1).toBeCloseTo(end.y1, 1);

  // Clicking a character's position in the rotated text puts the caret there.
  const fresh = await textLayout(page, 0, box.id);
  if (!fresh) throw new Error('No text layout.');
  const line = fresh.lines[0];
  const stop = line.stops.find((s) => s.index === 3);
  if (!stop) throw new Error('No caret stop 3.');
  const p = slidePoint(fresh, stop.x, (line.top + line.bottom) / 2);
  const at = await screen(page, p.x, p.y);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('X');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.id === box.id)
          ?.paragraphs?.[0].text
    )
    .toBe('QuaXrterly up');

  // The Format pane shows the direction; Stacked stands the letters up.
  await page.getByTestId('pptx-text-direction').click();
  await page.getByTestId('pptx-text-direction-more').click();
  await expect(page.getByTestId('pptx-pane-text-direction')).toHaveValue(
    'vert'
  );
  await page
    .getByTestId('pptx-pane-text-direction')
    .selectOption('wordArtVert');
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[0].shapes.find((s) => s.id === box.id)
          ?.textDirection
    )
    .toBe('wordArtVert');
  // Back to horizontal: the box turns back.
  await page.getByTestId('pptx-text-direction').click();
  await page.getByTestId('pptx-text-direction-horz').click();
  await expect
    .poll(async () => {
      const s = (await outline(page)).slides[0].shapes.find(
        (x) => x.id === box.id
      );
      return s && !s.textDirection && s.w > s.h;
    })
    .toBe(true);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('turns table cells from the Layout tab', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-thumbnail').nth(5).click();
  const table = (await outline(page)).slides[5].shapes.find(
    (s) => s.kind === 'table'
  );
  if (!table?.table) throw new Error('No table on slide 6.');
  const xs = [table.x];
  for (const w of table.table.columnWidths) xs.push(xs[xs.length - 1] + w);
  const ys = [table.y];
  for (const h of table.table.laidOutRowHeights) ys.push(ys[ys.length - 1] + h);
  const cell = await screen(page, (xs[1] + xs[2]) / 2, (ys[0] + ys[1]) / 2);
  await page.mouse.click(cell.x, cell.y);
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.getByTestId('pptx-tab-table-layout').click();
  await page.getByTestId('pptx-cell-text-direction').click();
  await page.getByTestId('pptx-cell-text-direction-vert270').click();
  await expect
    .poll(async () => {
      const t = (await outline(page)).slides[5].shapes.find(
        (s) => s.id === table.id
      )?.table;
      return t?.cells[0][1].textDirection;
    })
    .toBe('vert270');
  // The header row grew to the rotated text, and its caret runs up the cell.
  const grown = (await outline(page)).slides[5].shapes.find(
    (s) => s.id === table.id
  )?.table;
  expect(grown?.laidOutRowHeights[0]).toBeGreaterThan(
    table.table.laidOutRowHeights[0]
  );
  const c = await caret(page);
  expect(c.y1).toBeCloseTo(c.y2, 1);
});

/** The deck's guides as `[orient, position]`, sorted. */
async function guides(page: Page) {
  return ((await outline(page)).guides ?? [])
    .map((g) => [g.orient, Math.round(g.position * 100) / 100] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
}

/** Drags from one slide point to another (with `modifiers` held). */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: ('Control' | 'Alt')[] = []
) {
  const a = await screen(page, from.x, from.y);
  const b = await screen(page, to.x, to.y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

/** An empty spot of slide 1 (between the subtitle and the footer). */
const EMPTY_Y = 470;

test('shows, adds, moves, copies, and deletes guides, and saves them', async ({
  page,
}) => {
  await open(page);
  // The generated deck keeps PowerPoint 2010-style guides in its view
  // properties: a horizontal one at 3.75" and a vertical one at 5".
  expect(await guides(page)).toEqual([
    ['horizontal', 270],
    ['vertical', 360],
  ]);
  await expect(page.getByTestId('pptx-guides')).toHaveCount(0);
  await page.getByTestId('pptx-tab-view').click();
  await page.getByTestId('pptx-view-guides').click();
  await expect(page.getByTestId('pptx-guide')).toHaveCount(2);

  // Grid and Guides ▸ Add Vertical Guide puts one at the center.
  const empty = await screen(page, 60, EMPTY_Y);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Grid and Guides' }).hover();
  await page.getByRole('menuitem', { name: 'Add Vertical Guide' }).click();
  await expect(page.getByTestId('pptx-guide')).toHaveCount(3);
  expect(await guides(page)).toContainEqual(['vertical', 480]);

  // Dragging it shows its distance from the center and moves it.
  const a = await screen(page, 480, EMPTY_Y);
  const b = await screen(page, 300, EMPTY_Y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await expect(page.getByTestId('pptx-guide-tooltip')).toHaveText('← 2.50');
  await page.mouse.up();
  await expect(page.getByTestId('pptx-guide-tooltip')).toHaveCount(0);
  await expect.poll(() => guides(page)).toContainEqual(['vertical', 300]);
  expect(await guides(page)).not.toContainEqual(['vertical', 480]);

  // Ctrl+drag copies it.
  await drag(page, { x: 300, y: EMPTY_Y }, { x: 210, y: EMPTY_Y }, ['Control']);
  await expect
    .poll(() => guides(page))
    .toEqual([
      ['horizontal', 270],
      ['vertical', 210],
      ['vertical', 300],
      ['vertical', 360],
    ]);

  // Dragging a guide off the slide deletes it.
  await drag(page, { x: 210, y: EMPTY_Y }, { x: -30, y: EMPTY_Y });
  await expect.poll(async () => (await guides(page)).length).toBe(3);
  expect(await guides(page)).not.toContainEqual(['vertical', 210]);

  // A guide's menu deletes it and adds others; undo brings it back.
  const legacy = await screen(page, 360, EMPTY_Y);
  await page.mouse.click(legacy.x, legacy.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect.poll(() => guides(page)).not.toContainEqual(['vertical', 360]);
  await page.getByTestId('pptx-stage').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => guides(page)).toContainEqual(['vertical', 360]);
  const kept = await screen(page, 300, EMPTY_Y);
  await page.mouse.click(kept.x, kept.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Add Horizontal Guide' }).click();
  await expect.poll(async () => (await guides(page)).length).toBe(4);
  expect(await guides(page)).toContainEqual(['horizontal', 306]);
  await expect(page.getByTestId('pptx-guide')).toHaveCount(4);

  // Alt+F9 hides and shows them.
  await page.getByTestId('pptx-stage').focus();
  await page.keyboard.press('Alt+F9');
  await expect(page.getByTestId('pptx-guides')).toHaveCount(0);
  await page.keyboard.press('Alt+F9');
  await expect(page.getByTestId('pptx-guide')).toHaveCount(4);

  // They are saved in the file: reopening it shows them again.
  const expected = await guides(page);
  await page.keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() => page.evaluate(() => window.pptxFixture.saves()))
    .toBe(1);
  const bytes = await page.evaluate(() =>
    Array.from(window.pptxFixture.saved() ?? [])
  );
  await page.getByTestId('fixture-open').setInputFiles({
    name: 'Guides.pptx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByText('Guides.pptx')).toBeVisible();
  await expect.poll(() => guides(page)).toEqual(expected);
  await expect(page.getByTestId('pptx-guide')).toHaveCount(4);
  expect(await page.evaluate(() => window.pptxFixture.errors())).toEqual([]);
});

test('a dragged shape snaps to a guide unless Alt is held', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-view').click();
  await page.getByTestId('pptx-view-guides').click();
  // Smart guides off, so only the drawing guides attract the shape.
  await page.getByTestId('pptx-view-grid-settings').click();
  await page.getByTestId('pptx-view-smart-guides').uncheck();
  await page.keyboard.press('Escape');
  const box = await newTextBox(page, 'Snap me');
  await page.keyboard.press('Escape');
  const shape = (await outline(page)).slides[0].shapes.find(
    (s) => s.id === box.id
  );
  if (!shape) throw new Error('No text box.');
  // Grab the box's middle and move its left edge to 2 pt right of the
  // vertical guide at 360 (from the deck's view properties).
  const grab = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
  const dx = 362 - shape.x;
  await drag(page, grab, { x: grab.x + dx, y: grab.y + 40 });
  await expect
    .poll(async () => {
      const s = (await outline(page)).slides[0].shapes.find(
        (x) => x.id === box.id
      );
      return s && Math.round(s.x * 100) / 100;
    })
    .toBe(360);
  // With Alt held the shape lands where it is dropped.
  const moved = (await outline(page)).slides[0].shapes.find(
    (s) => s.id === box.id
  );
  if (!moved) throw new Error('No text box.');
  const from = { x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 };
  await drag(page, from, { x: from.x + 3, y: from.y }, ['Alt']);
  await expect
    .poll(async () => {
      const s = (await outline(page)).slides[0].shapes.find(
        (x) => x.id === box.id
      );
      return s && Math.round(s.x);
    })
    .toBe(363);
});
