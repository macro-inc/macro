import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
});

for (const composer of ['new', 'reply', 'reply-all', 'forward']) {
  test(`Cmd+Shift+C and Cmd+Shift+B open Cc and Bcc in the ${composer} composer`, async ({
    page,
  }) => {
    await page.goto(
      `/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=${composer}`
    );
    await page.locator('[contenteditable="true"]').click();

    await page.keyboard.press('ControlOrMeta+Shift+C');
    const cc = page
      .getByText('Cc', { exact: true })
      .locator('..')
      .getByRole('combobox');
    await expect(cc).toBeFocused();

    await page.keyboard.press('ControlOrMeta+Shift+B');
    const bcc = page
      .getByText('Bcc', { exact: true })
      .locator('..')
      .getByRole('combobox');
    await expect(bcc).toBeFocused();

    // Once the field is visible the shortcut only moves focus back to it.
    await page.keyboard.press('ControlOrMeta+Shift+C');
    await expect(cc).toBeFocused();
    await expect(page.getByTestId('thread-command')).toHaveText('none');
  });
}
