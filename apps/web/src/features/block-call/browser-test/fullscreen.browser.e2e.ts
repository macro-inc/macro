import { expect, test } from '@playwright/test';

const fixture = '/src/features/block-call/browser-test/view.html';

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 640]) {
    test(`fullscreen keeps the video and transcript state (${theme}, ${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?theme=${theme}`);
      const video = page.locator('video');
      await expect(video).toHaveCSS('opacity', '1');
      const originalVideo = await video.elementHandle();
      const card = page.getByRole('complementary', { name: 'Transcript' });
      const originalCard = await page
        .locator('.recording-transcript-card')
        .elementHandle();
      const fullscreen = page.getByRole('button', {
        name: 'Fullscreen',
        exact: true,
      });
      await fullscreen.click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.fullscreenElement?.classList.contains(
              'recording-workspace'
            )
          )
        )
        .toBe(true);
      await expect(card).toBeVisible();
      const toggle = page.getByRole('button', {
        name: 'Transcript',
        exact: true,
      });
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await card
        .getByRole('button', { name: /Playback has one transcript line/ })
        .click();
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime)
        )
        .toBe(1);
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.seeking)
        )
        .toBe(false);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await card.hover();
      await page.mouse.wheel(0, 1800);
      await expect
        .poll(() =>
          card.locator('.overflow-y-auto').evaluate((e) => e.scrollTop)
        )
        .toBeGreaterThan(50);
      await expect(
        card.getByRole('button', { name: 'Sync to video' })
      ).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(card).toBeHidden();
      await toggle.click();
      await expect(card).toHaveCSS('opacity', '1');
      await expect(
        card.getByRole('button', { name: 'Sync to video' })
      ).toBeVisible();
      await expect
        .poll(() =>
          video.evaluate(
            (element, original) => element === original,
            originalVideo
          )
        )
        .toBe(true);
      await expect
        .poll(() =>
          card.evaluate(
            (element, original) => element === original,
            originalCard
          )
        )
        .toBe(true);
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d69-${theme}-${width}.png`,
        });
      if (width > 700) {
        await page.getByRole('button', { name: 'Playback speed' }).click();
        await page
          .getByRole('menuitemradio', { name: '1.5×', exact: true })
          .click();
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.playbackRate)
          )
          .toBe(1.5);
      }
      await card.getByRole('button', { name: 'Sync to video' }).click();
      await expect(
        card.getByRole('button', { name: 'Sync to video' })
      ).toHaveCount(0);
      await toggle.click();
      await fullscreen.click();
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement))
        .toBe(null);
      await expect(toggle).toHaveCount(0);
      await fullscreen.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await fullscreen.click();
    });
  }
}

test('fullscreen transcript uses no transition under reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.locator('.recording-columns')).toHaveCSS(
    'transition-duration',
    '0s'
  );
  await expect(
    page.getByRole('complementary', { name: 'Transcript' })
  ).toHaveCSS('transition-duration', '0s');
});
