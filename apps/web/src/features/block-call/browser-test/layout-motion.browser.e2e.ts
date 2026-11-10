import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`player and transcript settle together (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(
      `/src/features/block-call/browser-test/view.html?theme=${theme}&pane=1107`
    );
    const video = page.locator('video');
    await expect(video).toHaveCSS('opacity', '1');
    const original = await video.elementHandle();
    const before = await video.boundingBox();
    await page.evaluate(async () => {
      document.getElementById('fixture-pane')!.style.maxWidth = '1108px';
      await new Promise(requestAnimationFrame);
    });
    const widths: number[] = [];
    for (const time of [0, 120, 240]) {
      await page.evaluate(async (time) => {
        for (const selector of [
          '.recording-player-column',
          '.recording-transcript-card',
        ])
          for (const animation of document
            .querySelector(selector)!
            .getAnimations()) {
            animation.pause();
            animation.currentTime = time;
          }
        await new Promise(requestAnimationFrame);
      }, time);
      const player = (await video.boundingBox())!;
      const card = (await page
        .locator('.recording-transcript-card')
        .boundingBox())!;
      widths.push(player.width);
      if (process.env.CALL_LAYOUT_PHASE !== 'before')
        expect(Math.abs(card.x - player.x - player.width - 28)).toBeLessThan(1);
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d70-${process.env.CALL_LAYOUT_PHASE ?? 'after'}-${theme}-${time}.png`,
        });
    }
    console.log({ theme, before: before!.width, widths });
    if (process.env.CALL_LAYOUT_PHASE !== 'before') {
      expect(widths[0]).toBeCloseTo(before!.width, 0);
      expect(widths[1]).toBeLessThan(widths[0]);
      expect(widths[1]).toBeGreaterThan(widths[2]);
    }
    expect(
      await video.evaluate(
        (element, previous) => element === previous,
        original
      )
    ).toBe(true);
  });
}

test('transcript-only records also animate on entry', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto(
    '/src/features/block-call/browser-test/view.html?pane=1107&no-recording'
  );
  await expect(
    page.getByRole('heading', { name: 'Recording fixture' })
  ).toBeVisible();
  await page.evaluate(async () => {
    document.getElementById('fixture-pane')!.style.maxWidth = '1108px';
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect
    .poll(() =>
      page
        .locator('.recording-transcript-card')
        .evaluate((e) => e.getAnimations().length)
    )
    .toBe(1);
  await expect(page.locator('video')).toHaveCount(0);
});
