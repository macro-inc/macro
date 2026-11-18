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

test('a channel open in two tabs keeps one draft in both', async ({ page }) => {
  // The composers render over synthetic props; no hosted data is read or written.
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
  await page.goto('/src/features/channel/Input/browser-test/draft.html?tabs');

  const first = page.getByRole('region', { name: 'First tab' });
  const second = page.getByRole('region', { name: 'Second tab' });
  const firstEditor = first.locator('[data-markdown-editable]');
  const secondEditor = second.locator('[data-markdown-editable]');
  await expect(firstEditor).toBeVisible({ timeout: 60_000 });
  await expect(secondEditor).toBeVisible();

  await firstEditor.click();
  await page.keyboard.type('typed in the first tab');
  await expect(secondEditor).toHaveText('typed in the first tab');

  await secondEditor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(', then the second');
  await expect(firstEditor).toHaveText(
    'typed in the first tab, then the second'
  );

  const chooser = page.waitForEvent('filechooser');
  await first.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Attach files' }).click();
  await (await chooser).setFiles({
    name: 'spec.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Spec'),
  });
  const removeSpec = { name: /^Remove spec/ };
  await expect(second.getByRole('button', removeSpec)).toBeVisible();
  await second.getByRole('button', removeSpec).click();
  await expect(first.getByRole('button', removeSpec)).toHaveCount(0);

  await page.reload();
  await expect(firstEditor).toHaveText(
    'typed in the first tab, then the second'
  );
  await expect(secondEditor).toHaveText(
    'typed in the first tab, then the second'
  );

  await secondEditor.click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Sent message' })).toHaveText(
    'typed in the first tab, then the second'
  );
  await expect(firstEditor).toHaveText('');
  await expect(secondEditor).toHaveText('');
});
