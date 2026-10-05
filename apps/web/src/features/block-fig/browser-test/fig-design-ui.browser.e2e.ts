import { expect, type Locator, type Page, test } from '@playwright/test';

// Figma's editing UI around the canvas: the right-click menus, the color
// and paint pickers, stroke dashes, several layers in the design panel,
// and the layers panel's selection and keyboard. Each test draws on a new,
// editable design (saves reopen to check they round-trip).

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  return { x: box.x + x, y: box.y + y };
}

/** A drag between two canvas-relative points. */
async function dragOnCanvas(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  const a = await canvasPoint(page, ...from);
  const b = await canvasPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Draws a rectangle (a new design opens at 100%, origin top left). */
async function drawRectangle(
  page: Page,
  from: [number, number],
  to: [number, number]
) {
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('r');
  await dragOnCanvas(page, from, to);
}

async function rightClick(page: Page, x: number, y: number) {
  const p = await canvasPoint(page, x, y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
}

const rows = (page: Page) => page.getByTestId('fig-layer-row');
const menu = (page: Page) => page.getByTestId('fig-context-menu');

/** The tile canvas pixel at a canvas-relative CSS point. */
function pixelAt(page: Page, x: number, y: number) {
  return page
    .getByTestId('fig-canvas')
    .locator('canvas')
    .first()
    .evaluate(
      (node, [px, py]) => {
        const canvas = node as HTMLCanvasElement;
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        const at = canvas
          .getContext('2d')
          ?.getImageData(
            Math.floor(px * ratio),
            Math.floor(py * ratio),
            1,
            1
          ).data;
        return at ? [at[0], at[1], at[2]] : [0, 0, 0];
      },
      [x, y]
    );
}

async function dragIn(
  locator: Locator,
  from: [number, number],
  to: [number, number]
) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Not visible.');
  const page = locator.page();
  await page.mouse.move(
    box.x + box.width * from[0],
    box.y + box.height * from[1]
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], {
    steps: 6,
  });
  await page.mouse.up();
}

test('right-click menus act on layers and the canvas', async ({ page }) => {
  await openNew(page);
  await drawRectangle(page, [100, 100], [200, 200]);
  await page.keyboard.press('Escape');

  // A right-click on a layer selects it and lists Figma's layer actions.
  await rightClick(page, 150, 150);
  await expect(menu(page)).toBeVisible();
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 1');
  for (const action of [
    'copy',
    'bring-to-front',
    'group',
    'add-auto-layout',
    'create-component',
    'toggle-visible',
    'flip-horizontal',
    'rename',
    'delete',
  ])
    await expect(page.getByTestId(`fig-menu-${action}`)).toBeVisible();
  await expect(page.getByTestId('fig-menu-paste-here')).toHaveAttribute(
    'data-disabled'
  );
  await page.getByTestId('fig-menu-copy').click();
  await expect(menu(page)).toBeHidden();
  await expect(page.getByTestId('fig-field-x')).toHaveValue('100');

  // On empty canvas: paste where the right-click was.
  await rightClick(page, 400, 300);
  await expect(page.getByTestId('fig-menu-zoom-fit')).toBeVisible();
  await page.getByTestId('fig-menu-paste-here').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId('fig-field-x')).toHaveValue('400');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('300');

  // Flip about the center: as in Figma, the panel keeps the flip apart
  // from position and rotation; undo.
  await rightClick(page, 450, 350);
  await page.getByTestId('fig-menu-flip-horizontal').click();
  await expect(page.getByTestId('fig-field-x')).toHaveValue('400');
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue('0');
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+z');
  // A vertical flip reads as a half turn about the center.
  await page.keyboard.press('Shift+V');
  await expect(page.getByTestId('fig-field-rotation')).toHaveValue(/^-?180$/);
  await expect(page.getByTestId('fig-field-y')).toHaveValue('400');

  // The same menu on a layers panel row.
  await rows(page).filter({ hasText: 'Rectangle 1' }).last().click({
    button: 'right',
  });
  await expect(menu(page)).toBeVisible();
  await page.getByTestId('fig-menu-toggle-visible').click();
  await expect(
    rows(page).last().getByTestId('fig-layer-visibility')
  ).toHaveAttribute('aria-label', 'Show');
  await rows(page).last().click({ button: 'right' });
  await page.getByTestId('fig-menu-delete').click();
  await expect(rows(page)).toHaveCount(1);
});

test('picks colors and edits gradients', async ({ page }) => {
  await openNew(page);
  await drawRectangle(page, [0, 0], [200, 200]);
  await page.getByTestId('fig-fill-0-swatch').click();
  const picker = page.getByTestId('fig-color-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId('fig-color-swatch').first()).toBeVisible();

  // Typed in a format of choice.
  await page.getByTestId('fig-color-field-0').fill('FF0000');
  await page.getByTestId('fig-color-field-0').press('Enter');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('FF0000');
  await expect
    .poll(async () => (await pixelAt(page, 20, 20)).join(','))
    .toBe('255,0,0');
  await page.getByTestId('fig-color-format').selectOption('rgb');
  await expect(page.getByTestId('fig-color-field-1')).toHaveValue('0');

  // A drag across the square is one undo step: top left is white.
  await dragIn(page.getByTestId('fig-color-area'), [0.9, 0.05], [0, 0]);
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('FFFFFF');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('FF0000');

  // Linear gradient: click the bar to add a stop, Delete removes it.
  await page.getByTestId('fig-fill-0-swatch').click();
  await page.getByTestId('fig-paint-type').selectOption('GRADIENT_LINEAR');
  await expect(page.getByTestId('fig-fill-0')).toContainText('Linear');
  const stops = page.getByTestId('fig-gradient-stop');
  await expect(stops).toHaveCount(2);
  await dragIn(page.getByTestId('fig-gradient-bar'), [0.5, 0.5], [0.5, 0.5]);
  await expect(stops).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(stops).toHaveCount(2);
  // The left of the rectangle is red, fading out to the right.
  await expect
    .poll(async () => (await pixelAt(page, 5, 100))[0])
    .toBeGreaterThan(240);
  await page.getByTestId('fig-paint-type').selectOption('GRADIENT_RADIAL');
  await expect(page.getByTestId('fig-fill-0')).toContainText('Radial');
});

test('adds, hides, reorders, and dashes paints', async ({ page }) => {
  await openNew(page);
  await drawRectangle(page, [0, 0], [100, 100]);
  await page.getByRole('button', { name: 'Add fill' }).click();
  await page.getByTestId('fig-fill-1-hex').fill('0000FF');
  await page.getByTestId('fig-fill-1-hex').press('Enter');
  // Top paint first; dragging the blue one below the gray moves it down.
  const hexes = page
    .getByTestId('fig-fills')
    .locator('input[data-testid$="-hex"]');
  await expect(hexes.first()).toHaveValue('0000FF');
  await page
    .getByTestId('fig-fill-1')
    .locator('[draggable="true"]')
    .dragTo(page.getByTestId('fig-fill-0'));
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('0000FF');
  await expect(hexes.first()).toHaveValue('D9D9D9');
  // The eye hides a paint, the "−" removes it.
  await page.getByTestId('fig-fill-1-visibility').click();
  await expect(page.getByTestId('fig-fill-1')).toHaveClass(/opacity-60/);
  await page.getByTestId('fig-fill-1-visibility').click();
  await page.getByTestId('fig-fill-1-remove').click();
  await expect(page.getByTestId('fig-fill-1')).toBeHidden();

  await page.getByRole('button', { name: 'Add stroke' }).click();
  await page.getByTestId('fig-field-dash').fill('4, 2');
  await page.getByTestId('fig-field-dash').press('Enter');
  await expect(page.getByTestId('fig-field-dash')).toHaveValue('4, 2');
  const id = await rows(page).first().getAttribute('data-layer-id');
  const dashes = () =>
    page.evaluate(
      async (layer) =>
        (await window.figFixture.engine()?.nodeInfo(0, layer ?? ''))
          ?.dashPattern,
      id
    );
  await expect.poll(dashes).toEqual([4, 2]);
  await page.getByTestId('fig-field-dash').fill('none');
  await page.getByTestId('fig-field-dash').press('Enter');
  await expect.poll(dashes).toBeNull();
});

test('edits several layers at once, with mixed values', async ({ page }) => {
  await openNew(page);
  await drawRectangle(page, [100, 100], [150, 150]);
  await drawRectangle(page, [200, 100], [300, 200]);
  await drawRectangle(page, [400, 100], [450, 150]);
  await page.getByTestId('fig-fill-0-hex').fill('0000FF');
  await page.getByTestId('fig-fill-0-hex').press('Enter');

  // Shift-click selects the rows between; ⌘/Ctrl-click toggles one.
  await rows(page).filter({ hasText: 'Rectangle 3' }).click();
  await rows(page)
    .filter({ hasText: 'Rectangle 1' })
    .click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('fig-mixed')).toContainText(
    '3 layers selected'
  );
  await expect(page.getByTestId('fig-field-w')).toHaveValue('Mixed');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('100');
  await expect(page.getByTestId('fig-fills')).toContainText('Mixed');

  // Typing sets every layer; "+" replaces mixed fills with one.
  await page.getByTestId('fig-field-w').fill('80');
  await page.getByTestId('fig-field-w').press('Enter');
  await expect(page.getByTestId('fig-field-w')).toHaveValue('80');
  await page.getByRole('button', { name: 'Add fill' }).click();
  await expect(page.getByTestId('fig-fill-0-hex')).toHaveValue('D9D9D9');

  await rows(page)
    .filter({ hasText: 'Rectangle 2' })
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('fig-mixed')).toContainText(
    '2 layers selected'
  );

  // As in Figma, arrow keys nudge the layer after its row is clicked.
  await rows(page).filter({ hasText: 'Rectangle 3' }).click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('101');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByTestId('fig-field-y')).toHaveValue('91');
  await expect(page.getByTestId('fig-name')).toHaveValue('Rectangle 3');
});

test('sets the canvas color from the picker', async ({ page }) => {
  await openNew(page);
  await page.getByTestId('fig-page-color').click();
  await expect(page.getByTestId('fig-color-alpha')).toBeHidden();
  await page.getByTestId('fig-color-field-0').fill('202020');
  await page.getByTestId('fig-color-field-0').press('Enter');
  await expect
    .poll(async () => (await pixelAt(page, 300, 300)).join(','))
    .toBe('32,32,32');
  await expect(page.getByTestId('fig-design-panel')).toContainText('202020');
});
