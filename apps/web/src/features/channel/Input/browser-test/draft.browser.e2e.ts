import { expect, test } from '@playwright/test';

/** The composer's visible lines, with an empty string per blank line. */
const lines = () =>
  Array.from(
    document.querySelectorAll('[data-markdown-editable] > p'),
    (paragraph) => paragraph.textContent ?? ''
  );

test('a draft keeps its blank line across leaving and reopening the channel', async ({
  page,
}) => {
  // The composer renders over synthetic props; no hosted data is read or written.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ responses: [] }),
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/channel/Input/browser-test/draft.html');

  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type('hello');
  // Shift+Enter is the composer's newline; Enter sends.
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('world');
  await expect.poll(() => page.evaluate(lines)).toEqual(['hello', '', 'world']);

  await page.getByRole('button', { name: 'Leave channel' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Open channel' }).click();
  await expect(editor).toBeVisible();

  await expect.poll(() => page.evaluate(lines)).toEqual(['hello', '', 'world']);
});
