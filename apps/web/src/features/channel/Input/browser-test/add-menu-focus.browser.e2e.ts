import { expect, test } from '@playwright/test';

/**
 * The + menu's Mention puts the caret in the composer and opens the mention
 * typeahead there: the menu's update lands while focus is on the menu, which
 * the editor's focus guard leaves alone (it only protects other text fields).
 */
test('+ → Mention opens the typeahead with typing in the composer', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    )
      await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/channel/Input/browser-test/draft.html');
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type('Hello');

  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Mention' }).click();

  await expect(editor).toBeFocused();
  await page.keyboard.type('ab');
  await expect(editor).toContainText('Hello @ab');
});
