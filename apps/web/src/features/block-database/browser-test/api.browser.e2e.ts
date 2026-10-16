import { expect, test } from '@playwright/test';

test('an API-only host pages rows, writes cells and creates columns through the shared controller', async ({
  page,
}) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/block-database/browser-test/api.html');
  await expect(page.getByRole('grid', { name: 'API records' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Name: Second\./ })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Name: First\./ }).dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Changed through API');
  await input.press('Tab');
  await expect(page.getByLabel('API writes')).toHaveText('1');
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(page.getByLabel('API writes')).toHaveText('2');
  await expect(
    page.getByRole('columnheader', { name: 'Unnamed', exact: true })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle editing' }).click();
  await expect(
    page.getByRole('button', { name: 'Add column', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle editing' }).click();
  await page.getByRole('button', { name: 'Show board' }).click();
  await expect(
    page.getByText('Changed through API', { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Move Changed through API', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Drag Changed through API', exact: true })
  ).toHaveCount(0);
});
