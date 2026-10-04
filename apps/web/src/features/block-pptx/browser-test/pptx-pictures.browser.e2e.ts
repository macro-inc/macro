import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
/** Slide 1's logo: picture 5, 108 pt square, centered at (478.8, 104.4). */
const LOGO = { id: 5, x: 478.8, y: 104.4 };

async function open(page: Page, query = '') {
  await page.goto(
    `/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0${query}`
  );
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

async function shape(page: Page, slide: number, id: number) {
  const deck = await outline(page);
  const found = deck.slides[slide].shapes.find((s) => s.id === id);
  if (!found) throw new Error(`No shape ${id} on slide ${slide + 1}.`);
  return found;
}

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function selectLogo(page: Page) {
  const at = await screen(page, LOGO.x, LOGO.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('pptx-selection')).toBeVisible();
  await page.getByTestId('pptx-tab-picture-format').click();
}

/** Where the whole image of a picture lies (unrotated). */
function imageBox(s: {
  x: number;
  y: number;
  w: number;
  h: number;
  picture?: {
    crop: { left: number; top: number; right: number; bottom: number };
  };
}) {
  const c = s.picture?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const w = s.w / (1 - c.left - c.right);
  const h = s.h / (1 - c.top - c.bottom);
  return { x: s.x - c.left * w, y: s.y - c.top * h, w, h };
}

async function drag(page: Page, testId: string, dx: number, dy: number) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} is not visible.`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}

test('Picture Format adjusts corrections, color, and transparency', async ({
  page,
}) => {
  await open(page);
  await selectLogo(page);

  await page.getByTestId('pptx-picture-corrections').click();
  await expect(
    page.getByTestId('pptx-picture-corrections-gallery')
  ).toBeVisible();
  await page.getByTestId('pptx-picture-correction-b+20_c-40').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture)
    .toMatchObject({ brightness: 0.2, contrast: -0.4 });

  await page.getByTestId('pptx-picture-color').click();
  await page.getByTestId('pptx-picture-recolor-duotone-accent1').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.recolor)
    .toBe('duotone:accent1');
  await page.getByTestId('pptx-picture-color').click();
  await page.getByTestId('pptx-picture-recolor-grayscale').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.recolor)
    .toBe('grayscale');

  await page.getByTestId('pptx-picture-transparency').click();
  await page.getByTestId('pptx-picture-transparency-50').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.transparency)
    .toBe(0.5);

  // The gallery shows the current choice.
  await page.getByTestId('pptx-picture-transparency').click();
  await expect(
    page.getByTestId('pptx-picture-transparency-50')
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  await page.getByTestId('pptx-picture-reset').click();
  await page.getByTestId('pptx-picture-reset-picture').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture)
    .toMatchObject({
      brightness: 0,
      contrast: 0,
      recolor: 'none',
      transparency: 0,
    });
});

test('crop mode crops with the handles, keeping the image in place', async ({
  page,
}) => {
  await open(page);
  await selectLogo(page);
  const before = await shape(page, 0, LOGO.id);

  await page.getByTestId('pptx-picture-crop').click();
  await expect(page.getByTestId('pptx-crop-overlay')).toBeVisible();
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
    await expect(page.getByTestId(`pptx-crop-handle-${handle}`)).toBeVisible();
  const stage = await page.getByTestId('pptx-stage').boundingBox();
  const deck = await outline(page);
  const px = (stage?.width ?? 1) / deck.width;
  // 27 pt off the right, 18 pt off the top: one crop on Enter.
  await drag(page, 'pptx-crop-handle-e', -27 * px, 0);
  await drag(page, 'pptx-crop-handle-n', 0, 18 * px);
  // Nothing is applied until crop mode ends.
  expect((await shape(page, 0, LOGO.id)).picture?.crop.right).toBe(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pptx-crop-overlay')).toBeHidden();

  await expect
    .poll(async () => {
      const crop = (await shape(page, 0, LOGO.id)).picture?.crop;
      return crop && [crop.right, crop.top].map((v) => Math.round(v * 100));
    })
    .toEqual([25, 17]);
  const after = await shape(page, 0, LOGO.id);
  const a = imageBox(after);
  const b = imageBox(before);
  for (const key of ['x', 'y', 'w', 'h'] as const)
    expect(a[key]).toBeCloseTo(b[key], 1);
  expect(after.w).toBeCloseTo(81, 0);

  // One undo step takes the whole crop back.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.crop)
    .toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
});

test('dragging the picture in crop mode pans the image under the frame', async ({
  page,
}) => {
  await open(page);
  await selectLogo(page);
  await page.getByTestId('pptx-picture-crop').click();
  const stage = await page.getByTestId('pptx-stage').boundingBox();
  const px = (stage?.width ?? 1) / (await outline(page)).width;
  await drag(page, 'pptx-crop-handle-w', 54 * px, 0);
  await drag(page, 'pptx-crop-frame', -20 * px, 0);
  // Clicking outside the picture commits.
  const empty = await screen(page, 120, 300);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.getByTestId('pptx-crop-overlay')).toBeHidden();
  await expect
    .poll(async () => {
      const s = await shape(page, 0, LOGO.id);
      const c = s.picture?.crop;
      return (
        c && [
          Math.round(c.left * 100),
          Math.round(c.right * 100),
          Math.round(s.x),
        ]
      );
    })
    .toEqual([69, -19, 479]);
});

test('Crop to an aspect ratio, fill, and fit', async ({ page }) => {
  await open(page);
  await selectLogo(page);
  await page.getByTestId('pptx-picture-crop-menu').click();
  await page.getByTestId('pptx-crop-aspect').hover();
  await page.getByTestId('pptx-crop-aspect-16x9').click();
  await expect
    .poll(async () => {
      const s = await shape(page, 0, LOGO.id);
      return [
        Math.round((s.picture?.crop.top ?? 0) * 1000),
        Math.round((s.picture?.crop.bottom ?? 0) * 1000),
        Math.round((s.w / s.h) * 100),
      ];
    })
    .toEqual([219, 219, 178]);
  // PowerPoint then lets the crop be adjusted; Esc keeps it.
  await expect(page.getByTestId('pptx-crop-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-crop-overlay')).toBeHidden();

  await page.getByTestId('pptx-picture-crop-menu').click();
  await page.getByTestId('pptx-crop-fit').click();
  await expect
    .poll(async () => {
      const c = (await shape(page, 0, LOGO.id)).picture?.crop;
      return c && Math.round(c.left * 1000);
    })
    .toBeLessThan(0);
  await page.getByTestId('pptx-picture-crop-menu').click();
  await page.getByTestId('pptx-crop-fill').click();
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.crop.top)
    .toBeGreaterThan(0.2);
});

test('Shape Effects add shadow, glow, reflection, and soft edges', async ({
  page,
}) => {
  await open(page);
  // The title (shape 2) and subtitle (shape 3) of slide 1, as one selection.
  const title = await screen(page, 480, 226);
  const subtitle = await screen(page, 480, 340);
  await page.mouse.click(title.x, title.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(subtitle.x, subtitle.y);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('pptx-selection-outline')).toHaveCount(2);
  await page.getByTestId('pptx-tab-shape-format').click();

  const pick = async (category: string, tile: string) => {
    await page.getByTestId('pptx-shape-effects').click();
    await page.getByTestId(`pptx-effects-${category}`).hover();
    await page.getByTestId(tile).click();
  };
  const effects = async () => {
    const deck = await outline(page);
    return deck.slides[0].shapes
      .filter((s) => s.id === 2 || s.id === 3)
      .map((s) => s.effects);
  };

  await pick('shadow', 'pptx-effect-shadow-outerBottomLeft');
  await expect
    .poll(async () => (await effects()).map((e) => e?.shadow?.preset))
    .toEqual(['outerBottomLeft', 'outerBottomLeft']);
  await pick('glow', 'pptx-effect-glow-accent2-8');
  await expect
    .poll(async () => (await effects()).map((e) => e?.glow?.sizePt))
    .toEqual([8, 8]);
  await pick('reflection', 'pptx-effect-reflection-tight4pt');
  await expect
    .poll(async () => (await effects()).map((e) => e?.reflection?.preset))
    .toEqual(['tight4pt', 'tight4pt']);
  await pick('soft-edges', 'pptx-effect-soft-edge-5');
  await expect
    .poll(async () => (await effects()).map((e) => e?.softEdge?.sizePt))
    .toEqual([5, 5]);

  // Each gallery choice was one undo step for both shapes.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await effects()).map((e) => e?.softEdge))
    .toEqual([undefined, undefined]);
  await pick('shadow', 'pptx-effect-shadow-none');
  await expect
    .poll(async () => (await effects()).map((e) => e?.shadow))
    .toEqual([undefined, undefined]);
});

test('Text Effects shadow and glow the selected text', async ({ page }) => {
  await open(page);
  const title = await screen(page, 480, 226);
  await page.mouse.click(title.x, title.y);
  await page.getByTestId('pptx-tab-shape-format').click();
  await page.getByTestId('pptx-text-effects').click();
  await page.getByTestId('pptx-text-effects-shadow').hover();
  await page.getByTestId('pptx-text-effect-shadow-outerBottomRight').click();
  await page.getByTestId('pptx-text-effects').click();
  await page.getByTestId('pptx-text-effects-glow').hover();
  await page.getByTestId('pptx-text-effect-glow-accent1-5').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const layout = await window.pptxFixture.engine()?.textLayout(0, 2);
        const e = layout?.styles[0]?.runs[0]?.effects;
        return e && [e.shadow?.preset, e.glow?.sizePt];
      })
    )
    .toEqual(['outerBottomRight', 5]);
});

test('the format pane sets effects and picture adjustments', async ({
  page,
}) => {
  await open(page);
  const at = await screen(page, LOGO.x, LOGO.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Format picture…' }).click();
  await expect(page.getByTestId('pptx-pane-picture')).toBeVisible();

  const brightness = page.getByTestId('pptx-pane-brightness');
  await brightness.fill('30');
  await brightness.press('Enter');
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.brightness)
    .toBeCloseTo(0.3, 5);
  const left = page.getByTestId('pptx-pane-crop-left');
  await left.fill('10');
  await left.press('Enter');
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).picture?.crop.left)
    .toBeCloseTo(0.1, 5);
  await expect(left).toHaveValue('10');

  await page.getByTestId('pptx-pane-tab-effects').click();
  const blur = page.getByTestId('pptx-pane-shadow-blur');
  await blur.fill('6');
  await blur.press('Enter');
  await expect
    .poll(async () => (await shape(page, 0, LOGO.id)).effects?.shadow?.blurPt)
    .toBe(6);
  await expect(page.getByTestId('pptx-pane-shadow-distance')).toHaveValue('3');
});

test('viewers get no Picture Format tab', async ({ page }) => {
  await open(page, '&readonly');
  const at = await screen(page, LOGO.x, LOGO.y);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('pptx-tab-home')).toBeVisible();
  await expect(page.getByTestId('pptx-tab-picture-format')).toHaveCount(0);
});
