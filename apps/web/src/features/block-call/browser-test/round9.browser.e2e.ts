import { expect, test } from '@playwright/test';

const fixture = '/src/features/block-call/browser-test/view.html';

for (const theme of ['light', 'dark']) {
  test(`Call again is a header action before Ask Macro (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}?theme=${theme}`);
    const header = page.locator('header').first();
    await expect(
      header.getByRole('button', { name: 'Call again' })
    ).toBeVisible();
    const actions = await header.getByRole('button').allTextContents();
    expect(actions.indexOf('Call again')).toBeLessThan(
      actions.indexOf('Ask Macro')
    );
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d55-${theme}.png`,
      });
  });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`transcript enters without remounting (${theme}, ${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto(`${fixture}?theme=${theme}&pane=1027`);
      const motion = await page.evaluate(async () => {
        const video = document.querySelector('video')!;
        video.dataset.mount = 'original';
        document.getElementById('fixture-pane')!.style.maxWidth = '1028px';
        await new Promise(requestAnimationFrame);
        const card = document.querySelector<HTMLElement>(
          '.recording-transcript-card'
        )!;
        const player = document.querySelector<HTMLElement>(
          '.recording-player-column'
        )!;
        const animations = [...card.getAnimations(), ...player.getAnimations()];
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = 120;
        }
        const sample = {
          count: animations.length,
          opacity: Number(getComputedStyle(card).opacity),
          transform: getComputedStyle(card).transform,
          playerTransform: getComputedStyle(player).transform,
        };
        for (const animation of animations) animation.finish();
        return sample;
      });
      if (reducedMotion === 'reduce') {
        expect(motion.count).toBe(0);
        expect(motion.transform).toBe('none');
        expect(motion.playerTransform).toBe('none');
      } else {
        expect(motion.count).toBe(2);
        expect(motion.opacity).toBeGreaterThan(0);
        expect(motion.opacity).toBeLessThan(1);
        expect(motion.transform).not.toBe('none');
        expect(motion.playerTransform).not.toBe('none');
      }
      await expect(page.locator('video')).toHaveAttribute(
        'data-mount',
        'original'
      );
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d56-${theme}-${reducedMotion}.png`,
        });
    });
  }
}
