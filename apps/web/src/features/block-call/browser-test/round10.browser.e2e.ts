import { expect, test } from '@playwright/test';

const fixture = '/src/features/block-call/browser-test/view.html';

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 580]) {
    test(`call action shares narrow header geometry (${theme}, ${width})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1800, height: 900 });
      await page.goto(`${fixture}?theme=${theme}&pane=${width}`);
      const button = page.getByRole('button', {
        name: 'Call again',
        exact: true,
      });
      const label = button.locator('[data-header-action-label]');
      if (width < 600) {
        await expect(label).toBeHidden();
        expect((await button.boundingBox())!.width).toBe(28);
      } else {
        await expect(label).toBeVisible();
      }
      await button.hover();
      await expect(page.getByRole('tooltip')).toHaveText('Call again');
      if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d63-${theme}-${width}.png`,
        });
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`transcript item spacing (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(`${fixture}?theme=${theme}`);
    const row = page.locator('[data-call-transcript-row] button').first();
    const spacing = await row.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.columnGap, style.rowGap];
    });
    expect(spacing).toEqual(['16px', '2px']);
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d64-${theme}.png`,
      });
  });
}

for (const theme of ['Macro Light', 'Paper', 'Macro Dark']) {
  test(`raised transcript surface (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(`${fixture}?theme=${encodeURIComponent(theme)}`);
    const card = page.getByRole('complementary', { name: 'Transcript' });
    await expect(page.locator('video')).toHaveCSS('opacity', '1');
    await expect(card).toHaveCSS('opacity', '1');
    const shadow = await card.evaluate(
      (element) => getComputedStyle(element).boxShadow
    );
    if (theme === 'Macro Dark') expect(shadow).toBe('none');
    else expect(shadow).not.toBe('none');
    if (process.env.CALL_PLAYBACK_SCREENSHOT_DIR)
      await page.screenshot({
        path: `${process.env.CALL_PLAYBACK_SCREENSHOT_DIR}/d66-${theme.replace(' ', '-')}.png`,
      });
  });
}
