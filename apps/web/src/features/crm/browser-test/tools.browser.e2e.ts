import { expect, test } from '@playwright/test';

test('agent entry and update cards retain amount denominations', async ({
  page,
}) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/crm/browser-test/tools.html');
  await expect(
    page.getByText('Contract value: EUR 1,234.567 · Outcome: Won · Owner: Alex')
  ).toBeVisible();
  await expect(
    page.getByText('Contract value: EUR 1,234.567 → USD 250')
  ).toBeVisible();
});
