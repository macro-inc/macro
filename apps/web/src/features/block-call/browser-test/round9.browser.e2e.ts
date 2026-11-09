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
  for (const width of [390, 680]) {
    test(`inline transcript rows align with the content (${theme}, ${width}px)`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: width === 390 ? 390 : 1440, height: 844 },
        hasTouch: width === 390,
        isMobile: width === 390,
      });
      try {
        const page = await context.newPage();
        await page.goto(`${fixture}?theme=${theme}&pane=${width}`);
        await page
          .locator('label')
          .filter({ hasText: /^Transcript$/ })
          .click();
        const card = page.getByRole('complementary', { name: 'Transcript' });
        const geometry = await card.evaluate((element) => {
          const card = element.getBoundingClientRect();
          const row = element
            .querySelector('[data-call-transcript-row]')!
            .getBoundingClientRect();
          const list = element.querySelector('[data-call-transcript-row]')!
            .parentElement!;
          return {
            offset: row.left - card.left,
            width: row.width - card.width,
            padding: getComputedStyle(list).paddingInline,
          };
        });
        expect(geometry).toEqual({ offset: 0, width: 0, padding: '0px' });
        if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
          await page.screenshot({
            path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d61-${theme}-${width}.png`,
          });
      } finally {
        await context.close();
      }
    });
  }
  test(`long speaker names truncate with a full tooltip (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${fixture}?theme=${theme}&long-name`);
    const name = page
      .locator('[data-call-transcript-row]')
      .nth(1)
      .locator('.truncate');
    const geometry = await name.evaluate((element) => ({
      overflowing: element.scrollWidth > element.clientWidth,
      ellipsis: getComputedStyle(element).textOverflow,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(geometry).toEqual({
      overflowing: true,
      ellipsis: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    await name.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'A very long guest display name that must truncate without shifting transcript timestamps'
    );
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const row = page
      .locator('[data-call-transcript-row]')
      .nth(1)
      .getByRole('button');
    await row.focus();
    await expect(page.getByRole('tooltip')).toHaveText(
      'A very long guest display name that must truncate without shifting transcript timestamps'
    );
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d59-${theme}.png`,
      });
    await row.press('Enter');
    await expect
      .poll(() =>
        page
          .locator('video')
          .evaluate((element: HTMLVideoElement) => element.currentTime)
      )
      .toBeCloseTo(1.1);
  });
  test(`timestamps keep a fixed right slot (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`${fixture}?theme=${theme}`);
    const card = page.getByRole('complementary', { name: 'Transcript' });
    await card
      .getByRole('button', { name: /Playback has one transcript line/ })
      .click();
    const slots = await card
      .locator('[data-call-transcript-row] .tabular-nums')
      .evaluateAll((timestamps) =>
        timestamps.slice(0, 6).map((timestamp) => {
          const slot = timestamp.parentElement!.getBoundingClientRect();
          const time = timestamp.getBoundingClientRect();
          return {
            right: slot.right,
            width: slot.width,
            timeRight: time.right,
          };
        })
      );
    expect(new Set(slots.map((slot) => slot.right)).size).toBe(1);
    expect(new Set(slots.map((slot) => slot.timeRight)).size).toBe(1);
    expect(slots.every((slot) => slot.width === 96)).toBe(true);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d58-${theme}.png`,
      });
  });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`active waveform follows native playback (${theme}, ${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto(`${fixture}?theme=${theme}`);
      const video = page.locator('video');
      await page
        .getByRole('button', { name: /Playback has one transcript line/ })
        .click();
      await video.evaluate(async (element: HTMLVideoElement) => {
        element.playbackRate = 0.1;
        await element.play();
      });
      const waveform = page.locator('[data-macro-icon="waveform"]');
      await expect(waveform).toHaveCount(1);
      await expect(waveform).toHaveCSS(
        'animation-name',
        reducedMotion === 'reduce' ? 'none' : 'recording-speaking'
      );
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d57-${theme}-${reducedMotion}.png`,
        });
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      await expect(waveform).toHaveCSS('animation-name', 'none');
    });
  }
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`transcript enters without remounting (${theme}, ${reducedMotion})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto(`${fixture}?theme=${theme}&pane=1107`);
      const motion = await page.evaluate(async () => {
        const video = document.querySelector('video')!;
        video.dataset.mount = 'original';
        document.getElementById('fixture-pane')!.style.maxWidth = '1108px';
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
