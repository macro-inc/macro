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
