import { expect, type Page, test } from '@playwright/test';

const PAGE = '/src/features/dialpad-connect/browser-test/dialpad.html';
type Connection = { state: string; issue?: string | null };

/** Answer the Dialpad routes from `connection`, recording connect bodies. */
async function serveDialpad(page: Page, connection: { current: Connection }) {
  const connects: unknown[] = [];
  await page.route('**/integrations/dialpad/connection/complete', (route) =>
    route.fulfill({ json: connection.current })
  );
  await page.route('**/integrations/dialpad/connection', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      connects.push(request.postDataJSON());
      connection.current = { state: 'connecting' };
      return route.fulfill({
        json: { connectUrl: 'about:blank#macro-connect' },
      });
    }
    if (request.method() === 'DELETE') {
      connection.current = { state: 'not_connected' };
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: connection.current });
  });
  return connects;
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
});

test('connecting asks how far back to import, then finishes setup', async ({
  page,
}, testInfo) => {
  const connection = { current: { state: 'not_connected' } as Connection };
  const connects = await serveDialpad(page, connection);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Connect Dialpad' }).click({
    timeout: 60_000,
  });
  const options = page.getByRole('menuitem');
  await expect(options).toHaveText([
    'New calls only',
    'Also import the last 7 days',
    'Also import the last 30 days',
    'Also import the last 90 days',
  ]);
  const popup = page.waitForEvent('popup');
  await page
    .getByRole('menuitem', { name: 'Also import the last 30 days' })
    .click();
  await popup;
  expect(connects).toEqual([{ backfill: 'month' }]);
  await expect(page.getByRole('img', { name: 'Connecting' })).toBeVisible();

  // The user approves Dialpad in Macro Connect; the row finishes setup itself.
  connection.current = { state: 'connected', issue: null };
  await expect(
    page.getByRole('button', { name: /^Disconnect Dialpad/ })
  ).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('connected.png') });

  await page.getByRole('button', { name: /^Disconnect Dialpad/ }).click();
  await expect(
    page.getByRole('button', { name: 'Connect Dialpad' })
  ).toBeVisible();
});

test('a lost grant asks to reconnect', async ({ page }) => {
  await serveDialpad(page, {
    current: { state: 'connected', issue: 'needs_reauth' },
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('img', { name: 'Reconnect needed' })).toBeVisible(
    {
      timeout: 60_000,
    }
  );
  await expect(
    page.getByRole('button', { name: 'Reconnect Dialpad' })
  ).toBeVisible();
});

test('a deployment without Macro Connect hides the row', async ({ page }) => {
  await serveDialpad(page, { current: { state: 'unavailable' } });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Dialpad unavailable')).toBeVisible({
    timeout: 60_000,
  });
});
