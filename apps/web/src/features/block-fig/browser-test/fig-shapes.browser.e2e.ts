import { expect, type Page, test } from '@playwright/test';

// Boolean operations, flattening, the pen and point editing, SVG export,
// and copying layers between files. New designs open at 100% with the page
// origin at the canvas's top left; saves stay in memory and are reopened.

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

/** The tile canvas's pixel at canvas-relative CSS coordinates. */
function pixelAt(page: Page, x: number, y: number) {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .first()
    .evaluate(
      (node, [px, py]) => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return [0, 0, 0, 0];
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const at = ctx.getImageData(
          Math.floor(px * ratio),
          Math.floor(py * ratio),
          1,
          1
        ).data;
        return [at[0], at[1], at[2], at[3]];
      },
      [x, y]
    );
}

/** Whether the canvas shows a new shape's gray (#D9D9D9) there. */
const isShape = async (page: Page, x: number, y: number) => {
  const [r, g, b] = await pixelAt(page, x, y);
  return (
    Math.abs(r - 217) < 6 && Math.abs(g - 217) < 6 && Math.abs(b - 217) < 6
  );
};

/** Whether a dark (stroke) pixel is within a pixel of there. */
const isDark = async (page: Page, x: number, y: number) => {
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const [r, g, b] = await pixelAt(page, x + dx, y + dy);
      if (r < 140 && g < 140 && b < 140) return true;
    }
  }
  return false;
};

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

async function clickOnCanvas(page: Page, x: number, y: number) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + y);
}

/** A rectangle (100, 100)–(260, 220) and an ellipse (180, 160)–(320, 300). */
async function drawTwoShapes(page: Page) {
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, [100, 100], [260, 220]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  await canvas.focus();
  await page.keyboard.press('o');
  await dragOnCanvas(page, [180, 160], [320, 300]);
  await expect(page.getByTestId('fig-name')).toHaveValue('Ellipse 1');
  await canvas.focus();
}

const errors = (page: Page) => page.evaluate(() => window.figFixture.errors());

test('combines shapes with boolean operations and flattens them', async ({
  page,
}) => {
  await openNew(page);
  await drawTwoShapes(page);
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('fig-design-panel')).toContainText(
    '2 layers selected'
  );
  // ⌥⇧S subtracts the ellipse (on top) from the rectangle.
  await page.keyboard.press('Alt+Shift+s');
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Subtract']);
  await expect(page.getByTestId('fig-boolean-subtract')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(() => isShape(page, 120, 120)).toBe(true);
  await expect.poll(() => isShape(page, 240, 200)).toBe(false);
  await expect(page.getByTestId('fig-field-w')).toHaveValue('160');

  // The design panel changes the operation: a union covers both.
  await page.getByTestId('fig-boolean-union').click();
  await expect(page.getByTestId('fig-name')).toHaveValue('Subtract');
  await expect.poll(() => isShape(page, 240, 200)).toBe(true);
  await expect.poll(() => isShape(page, 300, 280)).toBe(false);
  await expect(page.getByTestId('fig-field-w')).toHaveValue('220');

  // Undo goes back to the subtraction.
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => isShape(page, 240, 200)).toBe(false);

  // The toolbar menu flattens it into one vector layer.
  await page.getByTestId('fig-boolean-menu').click();
  await page.getByTestId('fig-menu-flatten').click();
  await expect(page.getByTestId('fig-design-panel')).toContainText('Vector');
  await expect(page.getByTestId('fig-layer-row')).toHaveCount(1);
  await expect.poll(() => isShape(page, 120, 120)).toBe(true);
  await expect.poll(() => isShape(page, 240, 200)).toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.figFixture.saves().length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await expect.poll(() => errors(page)).toEqual([]);
});

test('draws with the pen and edits the points', async ({ page }) => {
  await openNew(page);
  const canvas = page.getByTestId('fig-canvas');
  await canvas.focus();
  await page.keyboard.press('p');
  await expect(page.getByTestId('fig-tool-pen')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // Corners at (100, 100) and (300, 100), a curve through (300, 300), and
  // a click on the first point to close the path.
  await clickOnCanvas(page, 100, 100);
  await clickOnCanvas(page, 300, 100);
  await dragOnCanvas(page, [300, 300], [260, 340]);
  await clickOnCanvas(page, 100, 100);
  await expect(page.getByTestId('fig-layer-row')).toHaveText(['Vector 1']);
  await expect(page.getByTestId('fig-design-panel')).toContainText('Vector');
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('100');
  // The pen's default: a 1 px black stroke along the path. The selection
  // box covers the straight top edge; the curve's middle is at (315, 185).
  await expect.poll(() => isDark(page, 315, 185)).toBe(true);

  // Enter edits the points; dragging one reshapes the layer.
  await canvas.focus();
  await page.keyboard.press('Enter');
  await dragOnCanvas(page, [300, 100], [400, 60]);
  await expect(page.getByTestId('fig-field-y')).toHaveValue('60');
  await page.keyboard.press('Escape');
  await expect.poll(() => isDark(page, 250, 80)).toBe(true);
  // Undo puts the point back.
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('100');
  await expect.poll(() => errors(page)).toEqual([]);
});

test('exports SVG that draws like the PNG', async ({ page }) => {
  await page.goto('/?file=showcase.fig');
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
  await page.getByTestId('fig-layer-search').fill('Home');
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: 'Home' })
    .first()
    .click();
  await page.getByTestId('fig-export-svg').click();
  await expect
    .poll(() => page.evaluate(() => window.figFixture.downloads()))
    .toEqual([{ name: 'Home.svg', size: expect.any(Number) }]);

  // Drawn by the browser, the SVG matches the engine's PNG of the frame.
  const similarity = await page.evaluate(async () => {
    const engine = window.figFixture.engine();
    if (!engine) return 0;
    const [hit] = await engine.search(0, 'Home');
    const svg = await engine.exportSvg(0, hit.id);
    const png = await engine.exportPng(0, hit.id, 1);
    const load = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    const a = await load(URL.createObjectURL(png));
    const b = await load(
      URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    );
    const draw = (img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = a.naturalWidth;
      c.height = a.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return new Uint8ClampedArray();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const da = draw(a);
    const db = draw(b);
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      diff +=
        Math.abs(da[i] - db[i]) +
        Math.abs(da[i + 1] - db[i + 1]) +
        Math.abs(da[i + 2] - db[i + 2]);
    }
    return 1 - diff / ((da.length / 4) * 3 * 255);
  });
  expect(similarity).toBeGreaterThan(0.97);

  // "Copy as SVG" puts the markup on the clipboard.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('fig-copy-svg').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('<svg');
});

test('copies layers into another file', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?file=showcase.fig&edit');
  await expect(page.getByTestId('fig-layer-row').first()).toBeVisible();
  await page.getByTestId('fig-layer-search').fill('Primary button');
  await page
    .getByTestId('fig-search-hit')
    .filter({ hasText: 'Primary button' })
    .first()
    .click();
  await page.getByTestId('fig-layer-search').fill('');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+c');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        if (!item?.types.includes('text/html')) return '';
        return (await item.getType('text/html')).text();
      })
    )
    .toContain('(figma)');

  // In a new design the instance arrives detached (its component is not
  // there), with its override, where it was on the page.
  const other = await context.newPage();
  await openNew(other);
  await other.getByTestId('fig-canvas').focus();
  await other.keyboard.press('Control+v');
  await expect(other.getByTestId('fig-layer-row')).toHaveText([
    'Primary button',
  ]);
  await expect(other.getByTestId('fig-design-panel')).toContainText('Frame');
  await expect(other.getByTestId('fig-field-x')).toHaveValue('100');
  await expect(other.getByTestId('fig-field-y')).toHaveValue('420');
  await expect
    .poll(async () => {
      const [r, g, b] = await pixelAt(other, 180, 444);
      return r > 200 && g < 120 && b < 80;
    })
    .toBe(true);
  await expect
    .poll(() => other.evaluate(() => window.figFixture.saves().length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await expect.poll(() => errors(other)).toEqual([]);

  // Pasted into a selected frame, layers go inside it.
  await other.getByTestId('fig-canvas').focus();
  await other.keyboard.press('f');
  await dragOnCanvas(other, [500, 100], [800, 600]);
  // Numbered after the pasted frame.
  await expect(other.getByTestId('fig-name')).toHaveValue('Frame 2');
  await other.getByTestId('fig-canvas').focus();
  await other.keyboard.press('Control+v');
  await expect(other.getByTestId('fig-name')).toHaveValue('Primary button');
  await other.getByTestId('fig-canvas').focus();
  await other.keyboard.press('Shift+Enter');
  await expect(other.getByTestId('fig-name')).toHaveValue('Frame 2');
});
