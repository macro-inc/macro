import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const KITCHEN_SINK = 'generated/kitchen-sink-financial.pptx';
/** Two seconds of WebM (Playwright's Chromium has no H.264). */
const CLIP = readFileSync(
  fileURLToPath(new URL('./fixtures/clip.webm', import.meta.url))
);

/** A short sine tone as 16-bit mono WAV. */
function tone(seconds = 1, rate = 8000): Buffer {
  const samples = seconds * rate;
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    out.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)),
      44 + i * 2
    );
  return out;
}

async function open(page: Page) {
  await page.goto(`/?deck=${encodeURIComponent(KITCHEN_SINK)}&autosave=0`);
  await expect(page.getByTestId('pptx-editor')).toBeVisible();
  await expect(page.getByTestId('pptx-thumbnail').first()).toBeVisible();
}

function slideShapes(page: Page, index = 0) {
  return page.evaluate(async (index) => {
    const deck = await window.pptxFixture.engine()?.outline();
    return deck?.slides[index].shapes ?? [];
  }, index);
}

test('inserts a video, plays it on the slide and in the show', async ({
  page,
}) => {
  await open(page);
  const before = (await slideShapes(page)).length;
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-video-input').setInputFiles({
    name: 'demo.webm',
    mimeType: 'video/webm',
    buffer: CLIP,
  });
  await expect
    .poll(async () => (await slideShapes(page)).length)
    .toBe(before + 1);
  const video = (await slideShapes(page)).at(-1)!;
  expect(video.kind).toBe('picture');
  expect(video.media?.kind).toBe('video');
  expect(video.media?.part).toMatch(/^\/ppt\/media\/media\d+\.webm$/);
  expect(video.altText).toBe('demo.webm');
  // The 320×180 first frame sets a 16:9 frame.
  expect(video.w / video.h).toBeCloseTo(16 / 9, 1);
  // The clip round-trips through the engine untouched.
  const size = await page.evaluate(
    async (part) =>
      (await window.pptxFixture.engine()?.mediaBytes?.(part))?.length,
    video.media!.part!
  );
  expect(size).toBe(CLIP.length);

  // Selected, it offers Play; playing shows the browser's player over it.
  await page.getByTestId('pptx-media-play').click();
  const player = page.getByTestId('pptx-media-video');
  await expect(player).toBeVisible();
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  // A click elsewhere on the slide stops it.
  const stage = await page.getByTestId('pptx-stage').boundingBox();
  await page.mouse.click(stage!.x + 10, stage!.y + 10);
  await expect(page.getByTestId('pptx-media-player')).toHaveCount(0);

  // In the show a click on the video plays it instead of advancing.
  await page.getByTestId('pptx-tab-slideshow').click();
  await page.getByTestId('pptx-present-start').click();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 8');
  const view = page.viewportSize()!;
  const deck = await page.evaluate(() =>
    window.pptxFixture.engine()?.outline()
  );
  const scale = Math.min(view.width / deck!.width, view.height / deck!.height);
  await page.mouse.click(
    (view.width - deck!.width * scale) / 2 + (video.x + video.w / 2) * scale,
    (view.height - deck!.height * scale) / 2 + (video.y + video.h / 2) * scale
  );
  await expect(page.getByTestId('pptx-slideshow-media')).toBeVisible();
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('1 / 8');
  // The next slide leaves it behind.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('pptx-slideshow-counter')).toHaveText('2 / 8');
  await expect(page.getByTestId('pptx-slideshow-media')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('inserts audio as a speaker icon that plays', async ({ page }) => {
  await open(page);
  await page.getByTestId('pptx-tab-insert').click();
  await page.getByTestId('pptx-audio-input').setInputFiles({
    name: 'chime.wav',
    mimeType: 'audio/wav',
    buffer: tone(),
  });
  await expect
    .poll(async () => (await slideShapes(page)).at(-1)?.media?.kind)
    .toBe('audio');
  const audio = (await slideShapes(page)).at(-1)!;
  expect([Math.round(audio.w), Math.round(audio.h)]).toEqual([48, 48]);
  await page.getByTestId('pptx-media-play').click();
  await expect(page.getByTestId('pptx-media-audio')).toBeVisible();

  // Picking a file of the wrong kind explains instead.
  await page.getByTestId('pptx-video-input').setInputFiles({
    name: 'chime.wav',
    mimeType: 'audio/wav',
    buffer: tone(),
  });
  await expect
    .poll(() => page.evaluate(() => window.pptxFixture.errors()))
    .toContain('Choose an MP4, MOV, M4V, WebM, WMV, or AVI video.');
});
