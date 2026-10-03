import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
// Slide 1 of the kitchen-sink deck (ids and positions in points).
const TITLE = { slide: 256, shape: 2, x: 72, y: 168, w: 816, h: 116 };
const SUBTITLE = { slide: 256, shape: 3, x: 144, y: 306, w: 672, h: 138 };

async function open(page: Page, deck = KITCHEN_SINK, query = '') {
  await page.goto(`/?deck=${encodeURIComponent(deck)}${query}`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
  await expect.poll(() => inkedFraction(page)).toBeGreaterThan(0.01);
}

/** Share of slide-canvas pixels that differ from its corner (0 = blank). */
function inkedFraction(page: Page): Promise<number> {
  return page.getByTestId('pptx-slide-canvas').evaluate((node) => {
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

function outline(page: Page) {
  return page.evaluate(async () => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return engine.outline();
  });
}

async function shapeOn(page: Page, slideIndex: number, shapeId: number) {
  const deck = await outline(page);
  return deck.slides[slideIndex].shapes.find((s) => s.id === shapeId);
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function center(page: Page, s: typeof TITLE) {
  return screen(page, s.x + s.w / 2, s.y + s.h / 2);
}

test('renders the deck, its thumbnails, and native charts', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(8);
  await expect(page.getByTestId('pptx-thumbnail').first()).toHaveAttribute(
    'aria-label',
    'Slide 1: Q3 FY2024 Earnings Review'
  );
  // Slide 4 holds a combo chart drawn by the engine, not a fallback image.
  await page.getByTestId('pptx-thumbnail').nth(3).click();
  await expect(page.getByTestId('pptx-thumbnail').nth(3)).toHaveAttribute(
    'aria-current',
    /true|page/
  );
  await expect.poll(() => inkedFraction(page)).toBeGreaterThan(0.05);
});

test('types into a placeholder, undoes, and autosaves', async ({ page }) => {
  await open(page);
  const at = await center(page, TITLE);
  await page.mouse.dblclick(at.x, at.y);
  // The caret is a zero-width line, which Playwright never calls visible.
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.press('End');
  await page.keyboard.type(' (draft)');
  await expect
    .poll(
      async () => (await shapeOn(page, 0, TITLE.shape))?.paragraphs?.[0]?.text
    )
    .toBe('Q3 FY2024 Earnings Review (draft)');
  await expect(page.getByTestId('pptx-save-state')).toHaveText('Saved');
  const saves = await page.evaluate(() => window.pptxFixture.saves());
  expect(saves).toBeGreaterThan(0);
  const saved = await page.evaluate(() =>
    Array.from(window.pptxFixture.saved()?.slice(0, 2) ?? [])
  );
  expect(saved).toEqual([0x50, 0x4b]); // A zip ("PK").

  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(
      async () => (await shapeOn(page, 0, TITLE.shape))?.paragraphs?.[0]?.text
    )
    .toBe('Q3 FY2024 Earnings Review');
});

test('moves a shape by dragging and resizes it with a handle', async ({
  page,
}) => {
  await open(page);
  const from = await center(page, SUBTITLE);
  await page.mouse.click(from.x, from.y);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  const to = await screen(
    page,
    SUBTITLE.x + SUBTITLE.w / 2 + 48,
    SUBTITLE.y + SUBTITLE.h / 2 + 24
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await shapeOn(page, 0, SUBTITLE.shape))?.x)
    .toBeCloseTo(SUBTITLE.x + 48, 0);
  const moved = await shapeOn(page, 0, SUBTITLE.shape);
  expect(moved?.y).toBeCloseTo(SUBTITLE.y + 24, 0);

  const handle = page.getByTestId('pptx-handle-se');
  const box = await handle.boundingBox();
  if (!box) throw new Error('The resize handle is not visible.');
  const grip = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const scale = (to.x - from.x) / 48;
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 40 * scale, grip.y + 20 * scale, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await shapeOn(page, 0, SUBTITLE.shape))?.w)
    .toBeCloseTo(SUBTITLE.w + 40, 0);
});

test('inserts a text box and types into it', async ({ page }) => {
  await open(page);
  const before = (await outline(page)).slides[0]?.shapes.length ?? 0;
  await page.getByTestId('pptx-insert-textbox').click();
  // The caret is a zero-width line, which Playwright never calls visible.
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.type('Inserted note');
  await expect
    .poll(async () => {
      const shapes = (await outline(page)).slides[0]?.shapes ?? [];
      return shapes.length === before + 1
        ? shapes.at(-1)?.paragraphs?.[0]?.text
        : undefined;
    })
    .toBe('Inserted note');
});

test('adds and deletes slides from the rail', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New slide' }).click();
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(9);
  const thumbnail = page.getByTestId('pptx-thumbnail').nth(1);
  await thumbnail.hover();
  await thumbnail
    .locator('..')
    .getByRole('button', { name: 'Delete slide' })
    .click();
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(8);
});

test('loads an edit saved elsewhere, as an AI tool call would', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(
    ({ title }) =>
      window.pptxFixture.externalEdit([
        {
          op: 'setText',
          slide: title.slide,
          shape: title.shape,
          text: 'Q3 FY2024 Earnings Review — Board Draft',
        },
        {
          op: 'addSlide',
          layout: 'Title Only',
          after: title.slide,
          title: 'Key risks',
        },
      ]),
    { title: TITLE }
  );
  expect(result.structureChanged).toBe(true);
  await expect(page.getByTestId('fixture-notice')).toHaveText(
    'Updated with changes made elsewhere.'
  );
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(9);
  await expect(page.getByTestId('pptx-thumbnail').first()).toHaveAttribute(
    'aria-label',
    'Slide 1: Q3 FY2024 Earnings Review — Board Draft'
  );
  await expect(page.getByTestId('pptx-thumbnail').nth(1)).toHaveAttribute(
    'aria-label',
    'Slide 2: Key risks'
  );
});

test('keeps unsaved edits when the stored file changes elsewhere', async ({
  page,
}) => {
  await open(page, KITCHEN_SINK, '&autosave=0');
  const at = await center(page, TITLE);
  await page.mouse.dblclick(at.x, at.y);
  // The caret is a zero-width line, which Playwright never calls visible.
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(page.getByTestId('pptx-save-state')).toHaveText(
    'Unsaved changes'
  );
  await page.evaluate(
    ({ subtitle }) =>
      window.pptxFixture.externalEdit([
        {
          op: 'setText',
          slide: subtitle.slide,
          shape: subtitle.shape,
          text: 'Changed elsewhere',
        },
      ]),
    { subtitle: SUBTITLE }
  );
  await expect(page.getByTestId('fixture-notice')).toContainText(
    'changed elsewhere'
  );
  const title = await shapeOn(page, 0, TITLE.shape);
  expect(title?.paragraphs?.[0]?.text).toBe('Q3 FY2024 Earnings Review!');
});

test('opens real-world decks', async ({ page }) => {
  for (const deck of [
    'wild/dallasfed-fiscal-policy.pptx',
    'wild/milwaukee-2017-proposed-budget-overview.pptx',
    'generated/charts-advanced.pptx',
  ]) {
    await open(page, deck);
    expect((await outline(page)).slides.length).toBeGreaterThan(1);
  }
});

test('read-only viewers cannot edit', async ({ page }) => {
  await open(page, KITCHEN_SINK, '&readonly');
  const at = await center(page, TITLE);
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type('nope');
  await expect(page.getByTestId('pptx-caret')).toHaveCount(0);
  const title = await shapeOn(page, 0, TITLE.shape);
  expect(title?.paragraphs?.[0]?.text).toBe('Q3 FY2024 Earnings Review');
  expect(await page.evaluate(() => window.pptxFixture.saves())).toBe(0);
});
