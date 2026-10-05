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

/** Screen position of a slide point. */
async function screen(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  const deck = await outline(page);
  const scale = box.width / deck.width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

/** The distinct links (with ScreenTips) on a shape's first paragraph. */
function titleLinks(page: Page, index: number, shape: number) {
  return page.evaluate(
    async ([index, shape]) => {
      const layout = await window.pptxFixture
        .engine()
        ?.textLayout(index, shape);
      return [
        ...new Set(
          layout?.styles[0].runs.map((r) => `${r.link}|${r.linkTip}`) ?? []
        ),
      ];
    },
    [index, shape]
  );
}

test('links text to a slide, edits it, and follows it from the menu', async ({
  page,
}) => {
  await open(page);
  const deck = await outline(page);
  const target = deck.slides[2].id;
  // Select the title (slide 1, shape 2) and edit all of its text.
  const at = await screen(page, 480, 226);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByTestId('pptx-link-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('Insert Link');
  await page.getByTestId('pptx-link-kind-place').click();
  await page.getByTestId('pptx-link-place-slide-3').click();
  await expect(page.getByTestId('pptx-link-preview')).toBeVisible();
  await page.getByTestId('pptx-link-tip').fill('Jump to results');
  await page.getByTestId('pptx-link-ok').click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => titleLinks(page, 0, 2))
    .toEqual([`#slide=${target}|Jump to results`]);

  // Editing the link again starts from it; Next Slide replaces it.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog.getByRole('heading')).toHaveText('Edit Link');
  await expect(page.getByTestId('pptx-link-place-slide-3')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByTestId('pptx-link-tip')).toHaveValue(
    'Jump to results'
  );
  await page.getByTestId('pptx-link-place-nextslide').click();
  await page.getByTestId('pptx-link-ok').click();
  await expect
    .poll(() => titleLinks(page, 0, 2))
    .toEqual(['#nextslide|Jump to results']);

  // The right-click menu follows the link (to slide 2) and removes it.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Open link' }).click();
  await expect(page.getByTestId('pptx-thumbnail').nth(1)).toHaveAttribute(
    'aria-current',
    'true'
  );
  await page.getByTestId('pptx-thumbnail').nth(0).click();
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pptx-text-input')).toBeFocused();
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove link' }).click();
  await expect
    .poll(() => titleLinks(page, 0, 2))
    .toEqual(['undefined|undefined']);
});

test('inserts linked text at the caret and links whole shapes', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-insert-textbox').click();
  // The caret is a zero-width line, which Playwright never calls visible.
  await expect(page.getByTestId('pptx-caret')).toBeAttached();
  await page.keyboard.type('Read ');
  await page.getByTestId('pptx-insert-link').click();
  await page.getByTestId('pptx-link-address').fill('macro.com');
  // The address fills in the text to display until it is typed over.
  await expect(page.getByTestId('pptx-link-text')).toHaveValue('macro.com');
  await page.getByTestId('pptx-link-text').fill('our site');
  await page.getByTestId('pptx-link-ok').click();
  // The new text box is the slide's last shape.
  const before = (await outline(page)).slides[0].shapes.at(-1)!;
  const box = { id: before.id };
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const layout = await window.pptxFixture.engine()?.textLayout(0, id);
        const style = layout?.styles[0];
        return {
          text: layout?.paragraphs[0],
          linked: style?.runs
            .filter((r) => r.link)
            .map((r) => `${r.start}-${r.end} ${r.link}`),
        };
      }, box.id)
    )
    .toEqual({ text: 'Read our site', linked: ['5-13 https://macro.com'] });

  // With the shape selected (not its text), the link goes on the shape.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('pptx-link-text')).toBeDisabled();
  await page.getByTestId('pptx-link-kind-email').click();
  await page.getByTestId('pptx-link-email').fill('team@macro.com');
  await page.getByTestId('pptx-link-subject').fill('Hello');
  await page.getByTestId('pptx-link-ok').click();
  await expect
    .poll(async () => {
      const shapes = (await outline(page)).slides[0].shapes;
      return shapes.find((s) => s.id === box.id)?.link;
    })
    .toBe('mailto:team@macro.com?subject=Hello');
});

test('slide shows show ScreenTips and follow links on click', async ({
  page,
}) => {
  await open(page);
  const deck = await outline(page);
  const target = deck.slides[3].id;
  await page.evaluate(async (target) => {
    await window.pptxFixture.engine()?.apply([
      {
        op: 'formatText',
        slide: 256,
        shape: 2,
        props: { link: `#slide=${target}`, linkTip: 'See the details' },
      },
    ]);
  }, target);
  await page.getByTestId('pptx-tab-slideshow').click();
  await page.getByTestId('pptx-present-start').click();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 8');
  const regions = await page.evaluate(() =>
    window.pptxFixture.engine()?.linkRegions?.(0)
  );
  expect(regions?.length).toBeGreaterThan(0);
  const quad = regions![0].quad;
  const view = page.viewportSize()!;
  const scale = Math.min(view.width / deck.width, view.height / deck.height);
  const point = {
    x:
      (view.width - deck.width * scale) / 2 + ((quad[0] + quad[4]) / 2) * scale,
    y:
      (view.height - deck.height * scale) / 2 +
      ((quad[1] + quad[5]) / 2) * scale,
  };
  await page.mouse.move(point.x, point.y);
  await expect(page.getByTestId('pptx-slideshow-link-tip')).toHaveText(
    'See the details'
  );
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('4 / 8');
  // Elsewhere a click still advances.
  await page.mouse.click(view.width / 2, view.height - 20);
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('5 / 8');
  await page.keyboard.press('Escape');
});
