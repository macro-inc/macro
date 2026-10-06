import { expect, type Page, test } from '@playwright/test';

// Figma's shortcuts beyond the basics: the pencil, the actions menu (⌘P),
// ⌘. for the UI, aligning and distributing, opacity digits, and swapping
// fill and stroke. The fixture runs on Linux, so ⌘ is Ctrl here. New
// designs open at 100% with the page origin at the canvas's top left.

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

async function canvasBox(page: Page) {
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  return box;
}

async function dragOnCanvas(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
}

/** A rectangle from `x`, 100 px down, `w` wide and 50 tall. */
async function drawRectangle(page: Page, x: number, w: number, name: string) {
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [x, 100], [x + w, 150]);
  await expect(page.getByTestId('fig-name')).toHaveValue(name);
  await canvas.focus();
}

/** The selected layer's properties, from the engine. */
const selectedInfo = (page: Page, name: string) =>
  page.evaluate(async (n) => {
    const engine = window.figFixture.engine();
    const [hit] = (await engine?.search(0, n)) ?? [];
    return hit ? engine?.nodeInfo(0, hit.id) : undefined;
  }, name);

const errors = (page: Page) => page.evaluate(() => window.figFixture.errors());

test('draws freehand with the pencil (⇧P)', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('Shift+P');
  await expect(page.getByTestId('fig-tool-pencil')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // A curve: down, across, and up again.
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    await page.mouse.move(
      box.x + 100 + t * 200,
      box.y + 100 + Math.sin(t * Math.PI) * 120
    );
  }
  await page.mouse.up();
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Vector 1']);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');
  // Simplified: far fewer points than were drawn, still a curve.
  const network = await page.evaluate(async () => {
    const engine = window.figFixture.engine();
    const [hit] = (await engine?.search(0, 'Vector 1')) ?? [];
    return hit && engine?.vectorNetwork(0, hit.id);
  });
  expect(network?.vertices.length).toBeGreaterThan(2);
  expect(network?.vertices.length).toBeLessThan(20);
  expect(network?.regions).toEqual([]);
  // The pencil stays chosen, as in Figma; Escape goes back to Move.
  await expect(page.getByTestId('fig-tool-pencil')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fig-tool-move')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // P is still the pen.
  await page.keyboard.press('p');
  await expect(page.getByTestId('fig-tool-pen')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(() => errors(page)).toEqual([]);
});

test('runs actions from the actions menu (⌘P)', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  const printed = await page.evaluateHandle(() => {
    const seen = { prevented: [] as boolean[] };
    // After the viewer's own listener (capturing on the window too, it
    // stops the event going further).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'KeyP') seen.prevented.push(e.defaultPrevented);
      },
      true
    );
    return seen;
  });
  await page.keyboard.press('ControlOrMeta+p');
  const palette = page.getByTestId('fig-actions');
  await expect(palette).toBeVisible();
  // The browser does not print.
  expect(await printed.evaluate((s) => s.prevented)).toEqual([true]);
  await expect(page.getByTestId('fig-actions-input')).toBeFocused();
  await page.keyboard.type('ellip');
  await expect(page.getByTestId('fig-action-tool-ellipse')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('fig-tool-ellipse')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // Back on the canvas: its keys work again.
  await page.keyboard.press('v');
  await expect(page.getByTestId('fig-tool-move')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // Escape closes it; ⌘P again too.
  await page.keyboard.press('ControlOrMeta+p');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await page.keyboard.press('ControlOrMeta+p');
  await expect(palette).toBeVisible();
  await page.keyboard.press('ControlOrMeta+p');
  await expect(palette).toBeHidden();
});

test('hides and shows the UI with ⌘.', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-canvas').focus();
  await expect(page.getByTestId('fig-layers-panel')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.getByTestId('fig-layers-panel')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.getByTestId('fig-layers-panel')).toBeVisible();
});

test('aligns, distributes, sets opacity, and swaps fill and stroke', async ({
  page,
}) => {
  await openNew(page);
  await drawRectangle(page, 100, 40, 'Rectangle 1');
  await drawRectangle(page, 160, 60, 'Rectangle 2');
  await drawRectangle(page, 400, 20, 'Rectangle 3');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    '3 layers selected'
  );
  // Spans 100–420 with 120 of width: 100 between each.
  await page.keyboard.press('Control+Alt+h');
  await expect
    .poll(async () => (await selectedInfo(page, 'Rectangle 2'))?.x)
    .toBe(240);
  // ⌥A lines up their left edges.
  await page.keyboard.press('Alt+a');
  await expect
    .poll(async () => (await selectedInfo(page, 'Rectangle 3'))?.x)
    .toBe(100);

  // One layer: digits set its opacity, two quick ones exactly.
  await page
    .getByTestId('fig-layer-row')
    .filter({ hasText: 'Rectangle 1' })
    .click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('5');
  await expect
    .poll(async () => (await selectedInfo(page, 'Rectangle 1'))?.opacity)
    .toBeCloseTo(0.5);
  // A digit typed later starts over (one soon after would make 54%).
  await page.waitForTimeout(800);
  await page.keyboard.press('4');
  await page.keyboard.press('5');
  await expect
    .poll(async () => (await selectedInfo(page, 'Rectangle 1'))?.opacity)
    .toBeCloseTo(0.45);
  await page.waitForTimeout(800);
  await page.keyboard.press('0');
  await expect
    .poll(async () => (await selectedInfo(page, 'Rectangle 1'))?.opacity)
    .toBe(1);

  // ⇧X: the gray fill becomes the stroke.
  await page.keyboard.press('Shift+X');
  await expect
    .poll(async () => {
      const info = await selectedInfo(page, 'Rectangle 1');
      return {
        fills: info?.fills.length,
        stroke: info?.strokes[0]?.color,
      };
    })
    .toEqual({ fills: 0, stroke: 'D9D9D9' });
  await expect.poll(() => errors(page)).toEqual([]);
});
