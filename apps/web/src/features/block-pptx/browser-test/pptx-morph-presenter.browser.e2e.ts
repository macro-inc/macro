import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
/** Two seconds of WebM (Playwright's Chromium has no H.264). */
const CLIP = readFileSync(
  fileURLToPath(new URL('./fixtures/clip.webm', import.meta.url))
);

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function outline(page: Page) {
  return page.evaluate(async () => {
    const deck = await window.pptxFixture.engine()?.outline();
    if (!deck) throw new Error('No presentation is open.');
    return deck;
  });
}

test('Morph glides objects shared by two slides in the show', async ({
  page,
}) => {
  await open(page);
  // A copy of slide 1 whose title moved, shrank, and turned.
  const first = (await outline(page)).slides[0];
  const title = first.shapes[0];
  await page.evaluate(
    (slide) =>
      window.pptxFixture.externalEdit([{ op: 'duplicateSlide', slide }]),
    first.id
  );
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(9);
  const copyId = (await outline(page)).slides[1].id;
  await page.evaluate(
    ({ slide, shape }) =>
      window.pptxFixture.externalEdit([
        {
          op: 'setTransform',
          slide,
          shape,
          x: 300,
          y: 330,
          w: 400,
          h: 90,
          rotation: 20,
        },
      ]),
    { slide: copyId, shape: title.id }
  );
  await expect
    .poll(
      async () =>
        (await outline(page)).slides[1].shapes.find((s) => s.id === title.id)
          ?.rotation
    )
    .toBe(20);
  // Morph into the copy, from the Transitions tab, for 4 s.
  await page.getByTestId('pptx-thumbnail').nth(1).click();
  await page.getByTestId('pptx-tab-transitions').click();
  await page.getByTestId('pptx-transition-morph').click();
  const duration = page.getByTestId('pptx-transition-duration');
  await duration.fill('4');
  await duration.press('Enter');
  await expect
    .poll(async () => (await outline(page)).slides[1].transition)
    .toMatchObject({ kind: 'morph', durationMs: 4000 });
  const copy = (await outline(page)).slides[1];
  const moved = copy.shapes.find((s) => s.id === title.id)!;

  await page.getByTestId('pptx-tab-slideshow').click();
  await page.getByTestId('pptx-present-start').click();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 9');
  await page.keyboard.press('ArrowRight');
  const scene = page.getByTestId('pptx-morph');
  await expect(scene).toBeVisible();
  // Every object of the copy pairs with its original.
  await expect(scene).toHaveAttribute(
    'data-pairs',
    String(copy.shapes.filter((s) => !s.hidden).length)
  );
  // Halfway through, the title is halfway between its two places.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 2000;
    }
  });
  const sprite = scene.locator(
    `canvas[data-shape="${title.id}"][data-morph="from"]`
  );
  const box = (await sprite.boundingBox())!;
  const view = page.viewportSize()!;
  const deck = await outline(page);
  const scale = Math.min(view.width / deck.width, view.height / deck.height);
  const screen = (x: number, y: number) => ({
    x: (view.width - deck.width * scale) / 2 + x * scale,
    y: (view.height - deck.height * scale) / 2 + y * scale,
  });
  const from = screen(title.x + title.w / 2, title.y + title.h / 2);
  const to = screen(moved.x + moved.w / 2, moved.y + moved.h / 2);
  expect(box.x + box.width / 2).toBeCloseTo((from.x + to.x) / 2, -1);
  expect(box.y + box.height / 2).toBeCloseTo((from.y + to.y) / 2, -1);
  // A click finishes it; the slide is then shown as usual.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.play();
  });
  await expect(scene).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('2 / 9');
  await expect(page.getByTestId('pptx-slideshow-canvas')).toHaveAttribute(
    'data-slide-index',
    '1'
  );
  await page.keyboard.press('Escape');
});

test('Morph by Words carries each word to its new place', async ({ page }) => {
  await open(page);
  const first = (await outline(page)).slides[0];
  const title = first.shapes[0];
  await page.evaluate(
    (slide) =>
      window.pptxFixture.externalEdit([{ op: 'duplicateSlide', slide }]),
    first.id
  );
  await expect(page.getByTestId('pptx-thumbnail')).toHaveCount(9);
  const copyId = (await outline(page)).slides[1].id;
  // The same words, reordered, lower on the slide.
  await page.evaluate(
    ({ slide, shape }) =>
      window.pptxFixture.externalEdit([
        { op: 'setText', slide, shape, text: 'Earnings Review Q3 FY2024' },
        { op: 'setTransform', slide, shape, y: 380 },
      ]),
    { slide: copyId, shape: title.id }
  );
  await expect
    .poll(async () => (await outline(page)).slides[1].title)
    .toBe('Earnings Review Q3 FY2024');
  await page.getByTestId('pptx-thumbnail').nth(1).click();
  await page.getByTestId('pptx-tab-transitions').click();
  await page.getByTestId('pptx-transition-morph').click();
  await page.getByRole('button', { name: 'Effect options' }).click();
  await page.getByRole('button', { name: 'Words' }).click();
  const duration = page.getByTestId('pptx-transition-duration');
  await duration.fill('4');
  await duration.press('Enter');
  await expect
    .poll(async () => (await outline(page)).slides[1].transition)
    .toMatchObject({ kind: 'morph', direction: 'byWord', durationMs: 4000 });

  await page.getByTestId('pptx-tab-slideshow').click();
  await page.getByTestId('pptx-present-start').click();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 9');
  await page.keyboard.press('ArrowRight');
  const scene = page.getByTestId('pptx-morph');
  await expect(scene).toBeVisible();
  // The title's four words, and those the subtitle and footers keep.
  await expect(scene).toHaveAttribute('data-units', '18');
  const seek = (t: number) =>
    page.evaluate((t) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = t;
      }
    }, t);
  const word = `canvas[data-shape="${title.id}"]`;
  const middle = async (selector: string) => {
    const box = (await scene.locator(selector).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // Each word starts where it was and ends where the new slide has it.
  await seek(0);
  const q3 = await middle(`${word}[data-unit="Q3"][data-morph="from"]`);
  await seek(4000);
  const q3End = await middle(`${word}[data-unit="Q3"][data-morph="from"]`);
  const q3Target = await middle(`${word}[data-unit="Q3"][data-morph="to"]`);
  expect(q3End.x).toBeCloseTo(q3Target.x, -1);
  expect(q3End.y).toBeCloseTo(q3Target.y, -1);
  expect(q3End.y - q3.y).toBeGreaterThan(50);
  const review = await middle(`${word}[data-unit="Review"][data-morph="to"]`);
  // "Q3" moved from before "Review" to after it.
  expect(q3.x).toBeLessThan(review.x);
  expect(q3Target.x).toBeGreaterThan(review.x);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) a.play();
  });
  await expect(scene).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('Escape');
});

test('Presenter View plays a video on the audience screen', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-video-input').setInputFiles({
    name: 'demo.webm',
    mimeType: 'video/webm',
    buffer: CLIP,
  });
  await expect
    .poll(async () => (await outline(page)).slides[0].shapes.at(-1)?.media)
    .toBeTruthy();

  await page.getByTestId('pptx-tab-slideshow').click();
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('pptx-present-presenter').click();
  const audience = await opened;
  await expect(audience.getByTestId('pptx-audience-canvas')).toHaveAttribute(
    'data-slide-index',
    '0'
  );
  // The console's Play button starts it on the audience screen.
  await page.getByTestId('pptx-presenter-media-play').click();
  const clip = audience.getByTestId('pptx-audience-media');
  await expect(clip).toHaveCount(1);
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  // The console mirrors it with controls.
  await expect(page.getByTestId('pptx-presenter-media-video')).toBeVisible();
  await page.getByTestId('pptx-presenter-media-toggle').click();
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await expect(page.getByTestId('pptx-presenter-media-toggle')).toHaveAttribute(
    'aria-label',
    'Play'
  );
  await page
    .getByTestId('pptx-presenter-media-seek')
    .evaluate((input: HTMLInputElement) => {
      input.value = '0.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(0.5, 1);
  await expect(page.getByTestId('pptx-presenter-media-time')).toContainText(
    '0:00 / 0:02'
  );
  // Clicking the video on the audience screen plays it instead of advancing.
  await clip.click();
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await expect(page.getByTestId('pptx-presenter-counter')).toHaveText(
    'Slide 1 of 8'
  );
  // The next slide leaves it behind.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pptx-presenter-counter')).toHaveText(
    'Slide 2 of 8'
  );
  await expect(clip).toHaveCount(0);
  await expect(page.getByTestId('pptx-presenter-media-controls')).toHaveCount(
    0
  );
  await page.keyboard.press('Escape');
});
