import { expect, test } from '@playwright/test';

test('rebuilt call participant volume stays inside its stationary track', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.CALL_FULL_HOST !== 'true' || testInfo.project.name === 'phone'
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({ status: 404, json: {} });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    '/src/features/channel/Call/discussion/browser-test/call-overlay.html?chat=off&work=off&count=3'
  );
  const volumeButtons = page.getByRole('button', {
    name: 'Volume',
    exact: true,
  });
  await expect(volumeButtons.first()).toBeVisible({ timeout: 60_000 });
  await page
    .locator('[data-call-tile]')
    .filter({ has: volumeButtons.first() })
    .first()
    .hover();
  await volumeButtons.first().click();
  const slider = page.locator('[role="slider"]');
  const track = page.locator('[data-call-volume-track]');
  const fill = track.locator(':scope > div').first();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  const original = (await track.boundingBox())!;
  const thumb = (await slider.boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    thumb.x + thumb.width / 2,
    thumb.y + thumb.height / 2 + original.height * 0.75,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '25');
  expect(await track.boundingBox()).toEqual(original);
  const filled = (await fill.boundingBox())!;
  expect(filled.height).toBeCloseTo(original.height * 0.25, 0);
  expect(filled.y + filled.height).toBeCloseTo(original.y + original.height, 0);
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  expect((await fill.boundingBox())!.height).toBe(0);
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  expect((await fill.boundingBox())!.height).toBeCloseTo(original.height, 0);
  await slider.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuenow', '99');
  await page.keyboard.press('Escape');
  await volumeButtons.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('Escape');
  await volumeButtons.first().focus();
  await page.keyboard.press('Enter');
  await expect(slider).toHaveAttribute('aria-valuenow', '99');
  await page.screenshot({
    path: testInfo.outputPath('participant-volume.png'),
  });
});
