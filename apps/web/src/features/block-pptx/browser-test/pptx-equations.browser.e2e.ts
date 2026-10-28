import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
const OBJECT_CHAR = '￼';

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

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** A shape's paragraphs and equations, as the engine lays them out. */
function textOf(page: Page, index: number, shape: number) {
  return page.evaluate(
    async ([index, shape]) => {
      const layout = await window.pptxFixture
        .engine()
        ?.textLayout(index, shape);
      return {
        paragraphs: layout?.paragraphs ?? [],
        equations: (layout?.equations ?? []).map((e) => ({
          paragraph: e.paragraph,
          index: e.index,
          latex: e.latex,
          display: e.display,
        })),
      };
    },
    [index, shape]
  );
}

/** Pixels the shape alone inks (drawn over nothing). */
function inkedPixels(page: Page, index: number, shape: number) {
  return page.evaluate(
    async ([index, shape]) => {
      const engine = window.pptxFixture.engine();
      if (!engine) return 0;
      const bitmap = await engine.renderLayer(index, 960, 'only', shape);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) inked++;
      return inked;
    },
    [index, shape]
  );
}

test('inserts a built-in equation, edits it as linear text, and deletes it', async ({
  page,
}) => {
  await open(page);
  const before = (await outline(page)).slides[0].shapes.length;
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-equation-menu').click();
  await page.getByTestId('pptx-equation-prebuilt-quadratic-formula').click();

  // A new text box holds the equation, selected, with the Equation tab.
  await expect
    .poll(async () => (await outline(page)).slides[0].shapes.length)
    .toBe(before + 1);
  const shape = (await outline(page)).slides[0].shapes.at(-1)!;
  await expect
    .poll(() => textOf(page, 0, shape.id))
    .toEqual({
      paragraphs: [OBJECT_CHAR],
      equations: [
        {
          paragraph: 0,
          index: 0,
          latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
          display: true,
        },
      ],
    });
  await expect(page.getByTestId('pptx-tab-equation')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const input = page.getByTestId('pptx-equation-input');
  await expect(input).toHaveValue('x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}');
  await expect(
    page.getByTestId('pptx-equation-preview').locator('img')
  ).toBeVisible();
  // The equation is typeset on the slide: the box alone draws real ink.
  await expect.poll(() => inkedPixels(page, 0, shape.id)).toBeGreaterThan(400);

  // Typing linear text changes the equation on the slide as it goes.
  await input.fill('E=mc^2');
  await expect
    .poll(async () => (await textOf(page, 0, shape.id)).equations[0]?.latex)
    .toBe('E=mc^2');

  // A mistake is reported and leaves the slide alone.
  await input.fill('E=mc^{2');
  await expect(page.getByTestId('pptx-equation-error')).toBeVisible();
  await page.waitForTimeout(400);
  expect((await textOf(page, 0, shape.id)).equations[0]?.latex).toBe('E=mc^2');
  await input.fill('E=mc^2');
  await expect(page.getByTestId('pptx-equation-error')).toBeHidden();

  // Structures go in at the caret, with the caret in the first empty slot.
  await page.getByTestId('pptx-equation-structure-fraction').click();
  await page.getByTestId('pptx-equation-structure-fraction-0').click();
  await expect(input).toHaveValue('E=mc^2\\frac{}{}');
  await expect(input).toBeFocused();
  await page.keyboard.type('1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('2');
  await expect(input).toHaveValue('E=mc^2\\frac{1}{2}');
  await expect
    .poll(async () => (await textOf(page, 0, shape.id)).equations[0]?.latex)
    .toBe('E=mc^2\\frac{1}{2}');

  // Symbols too, at the caret (moved past the fraction).
  await page.keyboard.press('End');
  await page.getByTestId('pptx-equation-symbols').click();
  await page.getByTestId('pptx-equation-symbol-pm').click();
  await expect(input).toHaveValue('E=mc^2\\frac{1}{2}\\pm ');
  await page.keyboard.type('x');
  await expect
    .poll(async () => (await textOf(page, 0, shape.id)).equations[0]?.latex)
    .toBe('E=mc^2\\frac{1}{2}\\pm x');

  // A structure wraps the linear text selected before the gallery opened.
  await input.fill('a+b');
  await input.selectText();
  await page.getByTestId('pptx-equation-structure-radical').click();
  await page.getByTestId('pptx-equation-structure-radical-0').click();
  await expect(input).toHaveValue('\\sqrt{a+b}');
  await expect
    .poll(async () => (await textOf(page, 0, shape.id)).equations[0]?.latex)
    .toBe('\\sqrt{a+b}');

  // Escape leaves the equation selected on the slide; Delete removes it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pptx-equation-editor')).toBeHidden();
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect
    .poll(() => textOf(page, 0, shape.id))
    .toEqual({ paragraphs: [''], equations: [] });
  await expect(page.getByTestId('pptx-tab-equation')).toHaveCount(0);
});

test('writes an inline equation at the caret and edits it by clicking', async ({
  page,
}) => {
  await open(page);
  // Edit the title (slide 1, shape 2) with the caret at its end.
  const title = await screen(page, 480, 226);
  await page.mouse.click(title.x, title.y);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  await page.keyboard.press('End');
  const text = (await textOf(page, 0, 2)).paragraphs;
  await page.keyboard.type(' ');

  // Alt+= starts a new equation where the caret is.
  await page.keyboard.press('Alt+Equal');
  const editor = page.getByTestId('pptx-equation-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('pptx-equation-insert')).toHaveText('Insert');
  const input = page.getByTestId('pptx-equation-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('\\alpha^2+\\beta^2');
  await expect(
    page.getByTestId('pptx-equation-preview').locator('img')
  ).toBeVisible();
  await page.keyboard.press('Enter');

  const last = text.length - 1;
  await expect
    .poll(async () => (await textOf(page, 0, 2)).equations)
    .toEqual([
      {
        paragraph: last,
        index: text[last].length + 1,
        latex: '\\alpha^2+\\beta^2',
        display: false,
      },
    ]);
  expect((await textOf(page, 0, 2)).paragraphs[last]).toBe(
    `${text[last]} ${OBJECT_CHAR}`
  );
  // The new equation is selected; the editor now edits it.
  await expect(page.getByTestId('pptx-equation-insert')).toHaveText('Done');
  await expect(input).toHaveValue('\\alpha^2+\\beta^2');

  // Done closes the editor; clicking the equation selects it again.
  await page.getByTestId('pptx-equation-insert').click();
  await expect(editor).toBeHidden();
  const where = await page.evaluate(async () => {
    const layout = await window.pptxFixture.engine()?.textLayout(0, 2);
    const e = layout?.equations?.[0];
    if (!layout || !e) return null;
    const [a, b, c, d, tx, ty] = layout.transform;
    const x = e.x + e.w / 2;
    const y = e.y + e.h / 2;
    return { x: a * x + c * y + tx, y: b * x + d * y + ty };
  });
  expect(where).not.toBeNull();
  // Click elsewhere in the title first, then on the equation.
  await page.mouse.click(title.x - 200, title.y);
  await expect(page.getByTestId('pptx-tab-equation')).toHaveCount(0);
  const at = await screen(page, where!.x, where!.y);
  await page.mouse.click(at.x, at.y);
  await expect(editor).toBeVisible();
  await expect(input).toHaveValue('\\alpha^2+\\beta^2');
  await expect(page.getByTestId('pptx-tab-equation')).toBeVisible();

  // Undo takes the equation out again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await textOf(page, 0, 2)).equations)
    .toEqual([]);
});
