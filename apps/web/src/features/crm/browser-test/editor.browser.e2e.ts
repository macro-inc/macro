import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch({ maxRetries: 2 }) });
  });
  await page.route('**/__macro_dev/**', (route) => route.abort());
  // Local container network changes can cancel Vite's initial module requests.
  // Retry only that startup failure, never an editor interaction.
  let networkChanged = false;
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED')
      networkChanged = true;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    networkChanged = false;
    await page.goto('/src/features/crm/browser-test/editor.html');
    await page.waitForLoadState('networkidle');
    if (!networkChanged) break;
  }
  await expect(page.getByRole('grid', { name: 'Renewals' })).toBeVisible({
    timeout: 30000,
  });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the pipeline API powers the shared editor and respects column protections and grants', async ({
  page,
}) => {
  await expect(page.getByText('Acme', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Add sort', exact: true }).click();
  await page.getByRole('button', { name: 'Close sort' }).click();
  await expect(page.getByRole('button', { name: 'Sort 1' })).toBeFocused();
  await page.getByRole('button', { name: /^Notes: Follow up\./ }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit Notes' });
  await editor.fill('Renew in October');
  await editor.press('Tab');
  await expect(page.getByLabel('Pipeline writes')).toHaveText('1');
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(
    page.getByRole('columnheader', { name: 'Unnamed', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Pipeline writes')).toHaveText('2');
  await page.keyboard.press('Escape');
  await page
    .getByRole('columnheader', { name: 'Company', exact: true })
    .press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: 'Delete column' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle editing' }).click();
  await expect(
    page.getByRole('button', { name: 'Add column', exact: true })
  ).toHaveCount(0);
});

test('a cell in a row taller than its value takes clicks across its full height', async ({
  page,
}) => {
  // Wrapped multi-select pills grow a row the same way.
  await page.addStyleTag({ content: '[role="row"] { min-height: 8rem; }' });
  const cell = page
    .getByRole('gridcell')
    .filter({ has: page.getByRole('button', { name: /^Notes: Follow up\./ }) });
  const box = await cell.boundingBox();
  if (!box) throw new Error('Notes cell is not laid out');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await expect(page.getByRole('textbox', { name: 'Edit Notes' })).toBeVisible();
});
