import { expect, test } from '@playwright/test';

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
