import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`shows mute while dragging to zero and restores the speaker above zero (${theme})`, async ({
    page,
  }) => {
    await page.goto(
      `/src/features/block-call/browser-test/playback.html?theme=${theme}`
    );
    const video = page.locator('video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const mute = page.getByRole('button', { name: 'Mute', exact: true });
    await mute.hover();
    const slider = page.getByRole('slider', { name: 'Volume', exact: true });
    await expect(slider).toBeVisible();
    const thumb = await slider.boundingBox();
    const track = await page
      .getByRole('dialog', { name: 'Volume' })
      .locator('[data-orientation="vertical"]')
      .filter({ has: slider })
      .last()
      .boundingBox();
    if (!thumb || !track) throw new Error('Missing volume geometry');
    const x = thumb.x + thumb.width / 2;
    await page.mouse.move(x, thumb.y + thumb.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, track.y + track.height + 8, { steps: 16 });
    await expect(video).toHaveJSProperty('volume', 0);
    await expect(
      page.getByRole('button', { name: 'Unmute', exact: true })
    ).toBeVisible();
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d51-${theme}-zero.png`,
      });
    await page.mouse.move(x, track.y + track.height / 2, { steps: 10 });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume))
      .toBeGreaterThan(0);
    await expect(mute).toBeVisible();
    await page.mouse.up();
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d51-${theme}-audible.png`,
      });
    await mute.click();
    await expect(video).toHaveJSProperty('muted', true);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d51-${theme}-muted.png`,
      });
  });
}

test('drags volume, clicks the track, and adjusts with arrow keys without closing the popover', async ({
  page,
}) => {
  await page.goto('/src/features/block-call/browser-test/playback.html');
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Mute', exact: true }).hover();
  const volume = page.getByRole('slider', { name: 'Volume', exact: true });
  const popover = page.getByRole('dialog', { name: 'Volume', exact: true });
  await expect(volume).toBeVisible();
  const thumb = await volume.boundingBox();
  if (!thumb) throw new Error('Missing volume thumb');
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    thumb.x + thumb.width / 2,
    thumb.y + thumb.height / 2 + 65,
    { steps: 20 }
  );
  await expect(popover).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume))
    .toBeLessThan(0.8);
  const track = popover
    .locator('[data-orientation="vertical"]')
    .filter({ has: volume });
  const trackBox = await track.last().boundingBox();
  if (!trackBox) throw new Error('Missing volume track');
  await page.mouse.click(
    trackBox.x + trackBox.width / 2,
    trackBox.y + trackBox.height * 0.2
  );
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume))
    .toBeCloseTo(0.8, 1);
  await volume.focus();
  await volume.press('ArrowDown');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume))
    .toBeCloseTo(0.75);
  await expect(popover).toBeVisible();
  if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d41-drag-after.png`,
    });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`slides idle controls away and preserves interaction holds (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.clock.install();
    await page.goto('/src/features/block-call/browser-test/playback.html');
    const video = page.locator('video');
    await expect(video).toHaveJSProperty('readyState', 4);
    const player = page.getByRole('group', { name: 'Recording playback' });
    const controls = player.locator('[aria-hidden]').first();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await video.hover();
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'true');
    await expect(player).toHaveCSS('cursor', 'none');
    await expect(player.locator('[data-recording-controls]')).toHaveCSS(
      'opacity',
      '0'
    );
    await expect(controls).toHaveAttribute('inert', '');
    await video.hover({ position: { x: 25, y: 25 } });
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await pause.hover();
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    await page.getByRole('button', { name: 'Mute', exact: true }).hover();
    await page.clock.fastForward(3000);
    await expect(page.getByRole('dialog', { name: 'Volume' })).toBeVisible();
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    await page.mouse.click(10, 10);
    await video.hover();
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'true');
    await player.focus();
    await page.keyboard.press('Tab');
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    await pause.click();
    await video.hover();
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await video.hover();
    await page.clock.fastForward(3000);
    await expect(controls).toHaveAttribute('aria-hidden', 'true');
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR) {
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d42-fullscreen-${reducedMotion}.png`,
      });
    }
  });
}

test('clicks the picture to toggle playback without toggling for controls or overlays', async ({
  page,
}) => {
  await page.goto('/src/features/block-call/browser-test/playback.html');
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.click({ position: { x: 30, y: 30 } });
  await expect(video).toHaveJSProperty('paused', false);
  await video.click({ position: { x: 30, y: 30 } });
  await expect(video).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(video).toHaveJSProperty('paused', false);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(video).toHaveJSProperty('paused', false);
  await page.locator('#outside').click();
  await expect(video).toHaveJSProperty('paused', false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(video).toHaveJSProperty('paused', true);
});

test('touch first wakes hidden controls and the next picture tap pauses', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.clock.install();
    await page.goto('/src/features/block-call/browser-test/playback.html');
    const video = page.locator('video');
    await expect(video).toHaveJSProperty('readyState', 4);
    await video.tap({ position: { x: 25, y: 25 } });
    await expect(video).toHaveJSProperty('paused', false);
    await page.clock.fastForward(3000);
    const controls = page
      .getByRole('group', { name: 'Recording playback' })
      .locator('[aria-hidden]')
      .first();
    await expect(controls).toHaveAttribute('aria-hidden', 'true');
    await video.tap({ position: { x: 25, y: 25 } });
    await expect(controls).toHaveAttribute('aria-hidden', 'false');
    await expect(video).toHaveJSProperty('paused', false);
    await video.tap({ position: { x: 25, y: 25 } });
    await expect(video).toHaveJSProperty('paused', true);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d43-phone.png`,
      });
  } finally {
    await context.close();
  }
});

for (const theme of ['light', 'dark']) {
  test(`speed menu matches the main sort dropdown (${theme})`, async ({
    page,
  }) => {
    await page.goto(
      `/src/features/block-call/browser-test/playback.html?theme=${theme}&reference=sort`
    );
    const speed = page.getByRole('button', {
      name: 'Playback speed',
      exact: true,
    });
    await speed.click();
    const menu = page.getByRole('menu');
    await menu.evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    );
    const dimensions = await menu
      .getByRole('menuitemradio')
      .first()
      .evaluate((item) => {
        const style = getComputedStyle(item);
        return {
          height: item.getBoundingClientRect().height,
          padding: style.padding,
          fontSize: style.fontSize,
        };
      });
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d50-${theme}-speed.png`,
      });
    await menu
      .getByRole('menuitemradio', { name: '1.5×', exact: true })
      .click();
    await expect(page.locator('video')).toHaveJSProperty('playbackRate', 1.5);
    await expect(speed).toBeFocused();
    await page
      .getByRole('button', { name: 'Reference sort', exact: true })
      .click();
    await menu.evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    );
    const reference = await menu
      .getByRole('menuitemradio')
      .first()
      .evaluate((item) => {
        const style = getComputedStyle(item);
        return {
          height: item.getBoundingClientRect().height,
          padding: style.padding,
          fontSize: style.fontSize,
        };
      });
    expect(dimensions).toEqual(reference);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d50-${theme}-main-sort.png`,
      });
  });
}
