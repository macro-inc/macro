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
}
