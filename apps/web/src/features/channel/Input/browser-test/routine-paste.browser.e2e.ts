import { expect, test } from '@playwright/test';

const routineId = '01a16547-0000-7000-8000-000000000001';
// The app's link resolver also turns `/app/routines/<id>` into this mention;
// this fixture has no split router, so it pastes the block-name form.
const routineUrl = `https://dev.macro.com/app/routine/${routineId}`;

test('a pasted routine link shows and sends the routine name', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/scheduled-actions/${routineId}`))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: routineId,
          name: 'Daily CRM sweep',
          owner: 'macro|me@example.test',
          updated_at: '2026-11-13T18:00:00Z',
        }),
      });
    else if (
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
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, routineUrl);

  // The pasted link carries no label; the chip reads the routine's name.
  await expect(
    editor.getByRole('link', { name: 'Daily CRM sweep' })
  ).toBeVisible();
  await expect(editor.getByText('Loading...')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('composer.png') });

  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  // The name is saved on the mention, so the sent message carries it.
  await expect(page.getByLabel('Sent message')).toContainText(
    '"documentName":"Daily CRM sweep"'
  );
  await expect(page.getByLabel('Sent message')).toContainText(
    '"blockName":"routine"'
  );
});
