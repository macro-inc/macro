import { expect, type Locator, type Page, test } from '@playwright/test';

// A new 800 × 600 document (a white Background) in the real editor, with
// the engine in its worker; saves stay in the fixture's memory.

async function open(page: Page, query = '?new&size=800x600&reload') {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('psd-canvas')).toBeVisible();
  await expect(layerNames(page)).resolves.toContain('Background');
  // The document drew.
  await expect
    .poll(() => pixel(canvas(page), 0.5, 0.5))
    .toEqual([255, 255, 255]);
}

const canvas = (page: Page) => page.getByTestId('psd-canvas');

function layerNames(page: Page) {
  return page
    .getByTestId('psd-layer-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-layer-name')));
}

/** A drawn pixel at a fraction of the canvas, as RGB. */
function pixel(view: Locator, fx: number, fy: number) {
  return view
    .locator('canvas')
    .first()
    .evaluate(
      (node, [x, y]) => {
        const c = node as HTMLCanvasElement;
        const at = c
          .getContext('2d')
          ?.getImageData(
            Math.floor(c.width * x),
            Math.floor(c.height * y),
            1,
            1
          ).data;
        return at ? [at[0], at[1], at[2]] : [0, 0, 0];
      },
      [fx, fy]
    );
}

/** Drags between two fractions of the canvas. */
async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 8
) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1]
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps,
  });
  await page.mouse.up();
}

/** Focuses the editor without changing the document. */
async function focusEditor(page: Page) {
  await canvas(page).click({ position: { x: 4, y: 4 } });
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

test('opens a new document', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('psd-status')).toContainText('800 × 600 px');
  expect(await layerNames(page)).toEqual(['Background']);
  await expect(page.getByTestId('psd-tool-move')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('paints a brush stroke', async ({ page }) => {
  await open(page);
  await focusEditor(page);
  await page.keyboard.press('b');
  await expect(page.getByTestId('psd-options-tool')).toHaveText('Brush');
  await drag(page, [0.3, 0.5], [0.7, 0.5], 16);
  await expect.poll(() => pixel(canvas(page), 0.5, 0.5)).toEqual(BLACK);
  // Away from the stroke, the canvas stays white.
  expect(await pixel(canvas(page), 0.5, 0.3)).toEqual(WHITE);
  // The Background's pixels changed: its thumbnail shows the stroke.
  await expect(page.getByTestId('psd-undo')).toBeEnabled();
});

test('adds a layer, fills a selection, moves it, and undoes and redoes', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('psd-new-layer').click();
  await expect.poll(() => layerNames(page)).toEqual(['Layer 1', 'Background']);

  // A rectangular selection filled with the foreground (⌥⌫).
  await focusEditor(page);
  await page.keyboard.press('m');
  await drag(page, [0.3, 0.3], [0.5, 0.5]);
  await page.keyboard.press('Alt+Backspace');
  await expect.poll(() => pixel(canvas(page), 0.4, 0.4)).toEqual(BLACK);
  await page.keyboard.press('Control+d');

  // The Move tool drags the layer.
  await page.keyboard.press('v');
  await drag(page, [0.4, 0.4], [0.6, 0.6]);
  await expect.poll(() => pixel(canvas(page), 0.65, 0.65)).toEqual(BLACK);
  expect(await pixel(canvas(page), 0.35, 0.35)).toEqual(WHITE);

  // Undo puts it back; redo moves it again.
  await page.keyboard.press('Control+z');
  await expect.poll(() => pixel(canvas(page), 0.35, 0.35)).toEqual(BLACK);
  expect(await pixel(canvas(page), 0.65, 0.65)).toEqual(WHITE);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => pixel(canvas(page), 0.65, 0.65)).toEqual(BLACK);
  // The toolbar's buttons do the same.
  await page.getByTestId('psd-undo').click();
  await expect.poll(() => pixel(canvas(page), 0.35, 0.35)).toEqual(BLACK);
  await page.getByTestId('psd-redo').click();
  await expect.poll(() => pixel(canvas(page), 0.35, 0.35)).toEqual(WHITE);
});

test('types text and edits it again', async ({ page }) => {
  await open(page);
  await focusEditor(page);
  await page.keyboard.press('t');
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  const input = page.getByTestId('psd-text-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('Hello');
  await expect.poll(() => layerNames(page)).toEqual(['Hello', 'Background']);
  await page.keyboard.type(' world');
  // The layer takes its name from its text while it is typed.
  await expect
    .poll(() => layerNames(page))
    .toEqual(['Hello world', 'Background']);
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  // The text drew: some pixels just above the baseline are dark.
  await expect
    .poll(async () => {
      const shot = await canvas(page)
        .locator('canvas')
        .first()
        .evaluate((node) => {
          const c = node as HTMLCanvasElement;
          const ctx = c.getContext('2d');
          if (!ctx) return 255;
          const d = ctx.getImageData(
            Math.floor(c.width * 0.3),
            Math.floor(c.height * 0.5) - 30,
            200,
            30
          ).data;
          let darkest = 255;
          for (let i = 0; i < d.length; i += 4)
            darkest = Math.min(darkest, d[i]);
          return darkest;
        });
      return shot < 100;
    })
    .toBe(true);

  // Editing it again from the Properties panel.
  await page.getByTestId('psd-text-edit').click();
  await expect(input).toHaveValue('Hello world');
  await input.fill('Goodbye');
  await expect.poll(() => layerNames(page)).toEqual(['Goodbye', 'Background']);
  // Finishing gives the keys back to the editor; one undo takes the whole
  // edit back.
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => layerNames(page))
    .toEqual(['Hello world', 'Background']);
});

test('saves edits, and the saved file opens again', async ({ page }) => {
  await open(page);
  await focusEditor(page);
  await page.keyboard.press('b');
  await drag(page, [0.2, 0.2], [0.4, 0.4]);
  // Saving is debounced; `?reload` reopens each saved file in an engine.
  await expect
    .poll(() => page.evaluate(() => window.psdFixture.saves().length), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('psd-save-state')).toHaveAttribute(
    'data-state',
    'saved'
  );
  expect(await page.evaluate(() => window.psdFixture.errors())).toEqual([]);
});

test('zooms with the keyboard and fits the document', async ({ page }) => {
  await open(page);
  await focusEditor(page);
  await page.keyboard.press('Control+=');
  await expect(page.getByTestId('psd-zoom')).not.toHaveText('100%');
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('psd-zoom')).toHaveText('100%');
  await page.keyboard.press('Control+0');
  await expect(page.getByTestId('psd-zoom')).not.toHaveText('100%');
});

test('opens read-only without editing tools', async ({ page }) => {
  await open(page, '?new&size=400x300&readonly');
  await expect(page.getByTestId('psd-tool-brush')).toHaveCount(0);
  await expect(page.getByTestId('psd-undo')).toHaveCount(0);
  await focusEditor(page);
  await page.keyboard.press('b');
  await expect(page.getByTestId('psd-options-tool')).not.toHaveText('Brush');
});
