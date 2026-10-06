import { expect, test } from '@playwright/test';

test('edits embedded records without entity metadata or schema controls', async ({
  page,
}) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/block-database/browser-test/records.html', {
    waitUntil: 'domcontentloaded',
  });
  const grid = page.getByRole('grid', { name: 'Embedded records' });
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAttribute('aria-colcount', '2');
  await expect(page.getByRole('columnheader')).toHaveCount(2);
  await page.getByRole('button', { name: /^Name: First record\./ }).dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Updated record');
  await input.press('Tab');
  await expect(page.getByLabel('Stored name')).toHaveText('Updated record');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await page
    .getByRole('button', { name: 'Name: Updated record', exact: true })
    .dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit Name' })).toHaveCount(0);
  await expect(page.getByLabel('Stored name')).toHaveText('Updated record');
});
