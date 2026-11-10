import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
  await page.goto(
    '/src/features/email-compose/browser-test/recipient-hotkeys.html?composer=reply'
  );
});

test('one Escape in the editor closes an empty reply', async ({ page }) => {
  await page.locator('[contenteditable="true"]').click();

  await page.keyboard.press('Escape');

  await expect(page.getByTestId('reply-state')).toHaveText('closed');
});

test('one Escape in the editor hands a written reply back to its thread', async ({
  page,
}) => {
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await page.keyboard.type('Thanks');

  await page.keyboard.press('Escape');

  await expect(page.getByTestId('thread-exit')).toHaveText('selected');
  await expect(editor).not.toBeFocused();
  await expect(editor).toContainText('Thanks');
});

test('Escape closes an open editor menu before the reply', async ({ page }) => {
  await page.locator('[contenteditable="true"]').click();
  await page.keyboard.type(':smi');
  const menu = page.getByText('smirk', { exact: true });
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(menu).toBeHidden();
  await expect(page.getByTestId('thread-exit')).toHaveText('none');
});
