import { expect, type Page, test } from '@playwright/test';

// Handoff and layout aids: export presets and files, Export frames to PDF,
// Dev Mode inspect and code, layout grids, and ruler guides.

async function openShowcase(page: Page) {
  await page.goto('/?file=showcase.fig');
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
}

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

async function selectLayer(page: Page, name: string) {
  await page.getByTestId('fig-layer-search').fill(name);
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: name })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
}

async function dragOnCanvas(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 10 });
  await page.mouse.up();
}

/** Draws a frame by dragging, and returns its id. */
async function drawFrame(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('f');
  await dragOnCanvas(page, from, to);
  await expect(page.getByTestId('fig-layer-row').first()).toHaveText(/Frame/);
  return page.evaluate(async () => {
    const engine = window.figFixture.engine();
    const rows = (await engine?.layers(0)) ?? [];
    return rows[0]?.id ?? '';
  });
}

const savedCount = (page: Page) =>
  page.evaluate(() => window.figFixture.saves().length);

/** The overlay canvas pixel at canvas-relative CSS point `(x, y)`. */
function overlayPixel(page: Page, x: number, y: number) {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .nth(1)
    .evaluate(
      (node, [px, py]) => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        if (!ctx) return [0, 0, 0, 0];
        const d = ctx.getImageData(
          Math.floor(px * ratio),
          Math.floor(py * ratio),
          1,
          1
        ).data;
        return [d[0], d[1], d[2], d[3]];
      },
      [x, y]
    );
}

test('stores export presets and exports them as a ZIP', async ({ page }) => {
  await openNew(page);
  const id = await drawFrame(page, [100, 100], [300, 220]);
  const exports = page.getByTestId('fig-export');
  const add = exports.getByRole('button', { name: 'Add export' });
  await add.click();
  await expect(page.getByTestId('fig-export-size-0')).toHaveValue('1x');
  await add.click();
  await expect(page.getByTestId('fig-export-size-1')).toHaveValue('2x');
  await page.getByTestId('fig-export-format-1').selectOption('JPEG');
  await page.getByTestId('fig-export-suffix-0').fill('-small');
  await page.getByTestId('fig-export-suffix-0').press('Enter');
  await add.click();
  await page.getByTestId('fig-export-format-2').selectOption('SVG');
  await page.getByTestId('fig-export-options-2').click();
  await page.getByTestId('fig-export-include-id-2').check();
  await expect(page.getByTestId('fig-export-row-2')).toBeVisible();

  await page.getByTestId('fig-export-button').click();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.downloads()))
    .toEqual([
      { name: expect.stringMatching(/\.zip$/), size: expect.any(Number) },
    ]);

  // Saved into the file: the reopened design has them.
  await expect
    .poll(() => savedCount(page), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      page.evaluate(async (frame) => {
        const info = await window.figFixture.engine()?.nodeInfo(0, frame);
        return info?.exportSettings.map((s) => [
          s.format,
          s.value,
          s.suffix,
          s.svgIncludeId,
        ]);
      }, id)
    )
    .toEqual([
      ['PNG', 1, '-small', false],
      ['JPEG', 2, '', false],
      ['SVG', 1, '', true],
    ]);

  // Removing one keeps the others; a single preset downloads one file.
  await page.getByTestId('fig-export-remove-2').click();
  await page.getByTestId('fig-export-remove-1').click();
  await expect(page.getByTestId('fig-export-row-1')).toHaveCount(0);
  await page.getByTestId('fig-export-button').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.figFixture.downloads().map((d) => d.name))
    )
    .toEqual([expect.stringMatching(/\.zip$/), 'Frame 1-small.png']);
  await page.getByTestId('fig-export-preview-toggle').click();
  await expect(page.getByTestId('fig-export-preview')).toBeVisible();
});

test('exports the page frames to PDF', async ({ page }) => {
  await openShowcase(page);
  await page.getByTestId('fig-main-menu').click();
  await page.getByTestId('fig-menu-export-frames-pdf').click();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.downloads()))
    .toEqual([
      {
        name: expect.stringMatching(/Screens\.pdf$/),
        size: expect.any(Number),
      },
    ]);
  const size = await page.evaluate(
    () => window.figFixture.downloads()[0]?.size ?? 0
  );
  expect(size).toBeGreaterThan(1000);
});

test('inspects a layer in Dev Mode', async ({ page }) => {
  await openShowcase(page);
  await selectLayer(page, 'Card');
  await page.getByTestId('fig-panel-tab-code').click();
  const inspect = page.getByTestId('fig-dev-inspect');
  await expect(inspect).toBeVisible();
  await expect(page.getByTestId('fig-dev-width')).toHaveText('312px');
  await expect(page.getByTestId('fig-dev-height')).toHaveText('120px');
  await expect(page.getByTestId('fig-dev-colors')).toContainText('#FFFFFF');
  await expect(page.getByTestId('fig-css')).toContainText('box-shadow:');
  await page.getByTestId('fig-code-lang-tailwind').click();
  await expect(page.getByTestId('fig-code-tailwind')).toContainText(
    'w-[312px] h-[120px]'
  );
  await page.getByTestId('fig-code-lang-swiftui').click();
  await expect(page.getByTestId('fig-code-swiftui')).toContainText(
    'RoundedRectangle(cornerRadius: 16)'
  );
  await page.getByTestId('fig-code-lang-compose').click();
  await expect(page.getByTestId('fig-code-compose')).toContainText(
    '.width(312.dp)'
  );
});

test('lists exportable layers as Dev Mode assets', async ({ page }) => {
  await openNew(page);
  const id = await drawFrame(page, [100, 100], [200, 200]);
  await page
    .getByTestId('fig-export')
    .getByRole('button', { name: 'Add export' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async (frame) =>
          (await window.figFixture.engine()?.nodeInfo(0, frame))?.exportSettings
            .length,
        id
      )
    )
    .toBe(1);
  await page.getByTestId('fig-panel-tab-code').click();
  await expect(page.getByTestId('fig-dev-asset')).toHaveText('Frame 1.png');
  await page.getByTestId('fig-dev-asset').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.figFixture.downloads().map((d) => d.name))
    )
    .toEqual(['Frame 1.png']);
});

test('adds layout grids, toggles them, and saves them', async ({ page }) => {
  await openNew(page);
  const id = await drawFrame(page, [100, 100], [400, 300]);
  const grids = page.getByTestId('fig-layout-grids');
  await grids.getByRole('button', { name: 'Add layout grid' }).click();
  await expect(page.getByTestId('fig-grid-0')).toBeVisible();
  await page.getByTestId('fig-grid-type-0').selectOption('COLUMNS');
  await page.getByTestId('fig-grid-settings-0').click();
  await page.getByTestId('fig-grid-count-0').fill('3');
  await page.getByTestId('fig-grid-count-0').press('Enter');
  await expect(page.getByTestId('fig-grid-type-0')).toContainText(
    'Columns (3)'
  );
  await page.getByTestId('fig-grid-gutter-0').fill('30');
  await page.getByTestId('fig-grid-gutter-0').press('Enter');
  // Three 80 px columns with 30 px gutters: the first spans 100–180.
  await expect
    .poll(async () => (await overlayPixel(page, 140, 200))[3])
    .toBeGreaterThan(0);
  expect((await overlayPixel(page, 195, 200))[3]).toBe(0);
  // Ctrl+⇧4 (⌃G on a Mac) hides them.
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+Shift+Digit4');
  await expect
    .poll(async () => (await overlayPixel(page, 140, 200))[3])
    .toBe(0);
  await page.keyboard.press('Control+Shift+Digit4');
  await expect
    .poll(async () => (await overlayPixel(page, 140, 200))[3])
    .toBeGreaterThan(0);

  // Moving a layer inside snaps its edge to a column.
  await page.keyboard.press('r');
  await dragOnCanvas(page, [300, 150], [340, 190]);
  // Its left edge (300) moved 7 px left lands on the column at 290.
  await dragOnCanvas(page, [320, 170], [313, 170]);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('190');

  await expect
    .poll(() => savedCount(page), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(async (frame) => {
        const info = await window.figFixture.engine()?.nodeInfo(0, frame);
        return info?.layoutGrids.map((g) => [
          g.pattern,
          g.axis,
          g.count,
          g.gutter,
        ]);
      }, id)
    )
    .toEqual([['STRIPES', 'X', 3, 30]]);
});

test('drags guides out of the rulers, snaps to them, and removes them', async ({
  page,
}) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('Shift+R');
  const guides = () =>
    page.evaluate(async () => {
      const aids = await window.figFixture.engine()?.layoutAids(0);
      return aids?.guides.map((g) => [g.axis, Math.round(g.offset)]);
    });
  // From the top ruler down: a horizontal guide.
  await dragOnCanvas(page, [300, 8], [300, 260]);
  await expect.poll(guides).toHaveLength(1);
  const [[axis, offset]] = (await guides()) ?? [];
  expect(axis).toBe('Y');

  // A layer moved near it snaps to it.
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [160, 160]);
  const y = Number(await page.getByTestId('fig-field-y').inputValue());
  await dragOnCanvas(page, [130, 130], [130, 130 + (Number(offset) - y) - 3]);
  await expect(page.getByTestId('fig-field-y')).toHaveValue(String(offset));

  // Dragged back onto the ruler, it goes.
  await dragOnCanvas(page, [600, 260], [600, 5]);
  await expect.poll(guides).toEqual([]);
});
