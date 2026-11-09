import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const artifacts = process.env.CALL_REPRO_DIR;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
      ? route.continue()
      : route.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
});

for (const surface of ['bar', 'popover', 'player']) {
  test(`participant volume pointer and keyboard on ${surface}`, async ({
    page,
  }) => {
    for (const theme of ['dark', 'light']) {
      await page.goto(
        `/src/features/channel/Call/discussion/browser-test/call-overlay.html?surface=${surface}&theme=${theme}&work=off&chat=off`
      );
      if (surface === 'bar')
        await page.locator('[data-call-participant]').first().hover();
      await page
        .getByRole('button', { name: 'Volume', exact: true })
        .first()
        .click();
      const slider = page.getByRole('slider', { name: /Volume for/ }).first();
      await expect(slider).toBeVisible();
      const track = page.locator('[data-call-volume-track]');
      const bounds = await track.boundingBox();
      if (!bounds) throw new Error('Missing volume track');
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height * 0.75;
      await page.mouse.click(x, y);
      await expect
        .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
        .toBeGreaterThanOrEqual(23);
      expect(
        Number(await slider.getAttribute('aria-valuenow'))
      ).toBeLessThanOrEqual(27);
      let thumb = await slider.boundingBox();
      if (!thumb) throw new Error('Missing volume thumb');
      expect(Math.abs(thumb.y + thumb.height / 2 - y)).toBeLessThan(3);
      const player = page.getByRole('region', { name: 'Return to call' });
      const playerBefore =
        surface === 'player' ? await player.boundingBox() : null;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, bounds.y + bounds.height * 0.2, { steps: 12 });
      await page.mouse.up();
      await expect(slider).toBeVisible();
      expect(
        Number(await slider.getAttribute('aria-valuenow'))
      ).toBeGreaterThanOrEqual(78);
      thumb = await slider.boundingBox();
      expect(
        Math.abs(
          thumb!.y + thumb!.height / 2 - (bounds.y + bounds.height * 0.2)
        )
      ).toBeLessThan(3);
      if (playerBefore)
        expect(await player.boundingBox()).toEqual(playerBefore);
      await slider.press('ArrowDown');
      const prior = Number(await slider.getAttribute('aria-valuenow'));
      await page.mouse.wheel(0, -100);
      await expect(slider).toHaveAttribute('aria-valuenow', String(prior + 1));
      if (artifacts) {
        await mkdir(artifacts, { recursive: true });
        await page.screenshot({
          path: `${artifacts}/L119-${surface}-${theme}.png`,
        });
      }
    }
  });
}

test('only explicit zero volume marks a participant muted for you', async ({
  page,
}) => {
  for (const theme of ['dark', 'light']) {
    await page.goto(
      `/src/features/channel/Call/discussion/browser-test/call-overlay.html?theme=${theme}&work=off&chat=off&sdkVolume=zero`
    );
    const tile = page.locator('[data-call-participant]').first();
    await tile.hover();
    const button = page
      .getByRole('button', { name: 'Volume', exact: true })
      .first();
    await button.click();
    const slider = page.getByRole('slider', { name: /Volume for/ }).first();
    await expect(slider).toHaveAttribute('aria-valuenow', '100');
    await expect(page.locator('[data-call-muted-for-you]')).toHaveCount(0);
    if (artifacts)
      await page.screenshot({ path: `${artifacts}/L120-unset-${theme}.png` });
    await slider.press('Home');
    await expect(
      tile.locator('[data-call-muted-for-you]').first()
    ).toBeVisible();
    if (artifacts)
      await page.screenshot({ path: `${artifacts}/L120-zero-${theme}.png` });
    await slider.press('End');
    await expect(page.locator('[data-call-muted-for-you]')).toHaveCount(0);
  }
});
