import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function animations(page: Page, slide: number) {
  return page.evaluate(async (index) => {
    const engine = window.pptxFixture.engine();
    if (!engine) throw new Error('No presentation is open.');
    return (await engine.outline()).slides[index].animations ?? [];
  }, slide);
}

/** Clicks a slide point on the stage. */
async function clickAt(page: Page, x: number, y: number) {
  const box = await page.getByTestId('pptx-stage').boundingBox();
  if (!box) throw new Error('The stage is not visible.');
  await page.mouse.click(
    box.x + (x * box.width) / 960,
    box.y + (y * box.width) / 960
  );
}

test('animates shapes from the Animations tab and plays them in the show', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-thumbnail').nth(2).click();
  await page.getByTestId('pptx-tab-animations').click();
  // Card 1: Fly In from the left.
  await clickAt(page, 140, 160);
  await page.getByTestId('pptx-animation-gallery').click();
  await page.getByTestId('pptx-animation-entrance-flyIn').click();
  await page.getByTestId('pptx-animation-options').click();
  await page.getByTestId('pptx-animation-option-left').click();
  // Card 2: Zoom, after the previous one, 1 s.
  await clickAt(page, 360, 160);
  await page.getByTestId('pptx-animation-gallery').click();
  await page.getByTestId('pptx-animation-entrance-zoom').click();
  await page.getByTestId('pptx-animation-start').selectOption('afterPrevious');
  const duration = page.getByTestId('pptx-animation-duration');
  await duration.fill('1');
  await duration.press('Enter');
  // The title also spins, on its own click.
  await clickAt(page, 480, 60);
  await page.getByTestId('pptx-animation-add').click();
  await page.getByTestId('pptx-animation-emphasis-spin').click();
  await expect
    .poll(async () =>
      (await animations(page, 2)).map((a) => [
        a.class,
        a.effect,
        a.direction,
        a.start,
        a.durationMs,
      ])
    )
    .toEqual([
      ['entrance', 'flyIn', 'left', 'onClick', 500],
      ['entrance', 'zoom', 'objectCenter', 'afterPrevious', 1000],
      ['emphasis', 'spin', 'clockwise', 'onClick', 2000],
    ]);
  // The pane lists them with click numbers; tags mark the shapes.
  await page.getByTestId('pptx-animation-pane-toggle').click();
  await expect(page.getByTestId('pptx-animation-row')).toHaveCount(3);
  await expect(page.getByTestId('pptx-animation-tag')).toHaveCount(3);
  // Reorder: the spin first, then remove it.
  await page.getByTestId('pptx-animation-row').nth(2).click();
  await page.getByTestId('pptx-animation-earlier').click();
  await expect
    .poll(async () => (await animations(page, 2)).map((a) => a.effect))
    .toEqual(['flyIn', 'spin', 'zoom']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await animations(page, 2)).map((a) => a.effect))
    .toEqual(['flyIn', 'zoom', 'spin']);

  // The show steps through the clicks before moving on.
  await page.keyboard.press('Shift+F5');
  const canvas = page.getByTestId('pptx-slideshow-canvas');
  await expect(canvas).toHaveAttribute('data-slide-index', '2');
  await expect(canvas).toHaveAttribute('data-step', '0');
  // Animated shapes are separate pieces; entrances start hidden.
  const card = canvas.locator('[data-piece="5"]').first();
  await expect(card).toHaveCSS('visibility', 'hidden');
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-step', '1');
  await expect(card).toHaveCSS('visibility', 'visible');
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-step', '2');
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-slide-index', '3');
  // Back lands on the slide fully built.
  await page.keyboard.press('ArrowLeft');
  await expect(canvas).toHaveAttribute('data-slide-index', '2');
  await expect(canvas).toHaveAttribute('data-step', '2');
  await page.keyboard.press('Escape');
});

test('builds a text shape paragraph by paragraph', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-thumbnail').nth(1).click();
  await page.getByTestId('pptx-tab-animations').click();
  // The agenda's bulleted body.
  const deck = await page.evaluate(async () =>
    window.pptxFixture.engine()?.outline()
  );
  const body = deck?.slides[1].shapes.find(
    (s) => (s.paragraphs?.length ?? 0) > 2
  );
  if (!body) throw new Error('No multi-paragraph shape on slide 2.');
  await clickAt(page, body.x + 20, body.y + 10);
  await page.getByTestId('pptx-animation-gallery').click();
  await page.getByTestId('pptx-animation-entrance-fade').click();
  await page.getByTestId('pptx-animation-options').click();
  await page.getByTestId('pptx-animation-sequence-paragraph').click();
  await expect
    .poll(async () => (await animations(page, 1)).map((a) => a.paragraph))
    .toEqual(
      body.paragraphs
        ?.map((_, i) => i)
        .filter((i) => (body.paragraphs?.[i]?.text.trim() ?? '') !== '')
    );
  await page.getByTestId('pptx-animation-preview').click();
  await expect(page.getByTestId('pptx-animation-preview-canvas')).toBeVisible();
  await expect(
    page.getByTestId('pptx-animation-preview-canvas').locator('[data-piece]')
  ).not.toHaveCount(0);
});
