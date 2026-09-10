import { expect, test } from '@playwright/test';

test('notification state memberships survive optimistic rollback and authoritative changes', async ({
  page,
}) => {
  await page.goto('/notification-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'passed',
    { timeout: 60_000 }
  );
  await expect(page.locator('#result')).toContainText(
    'Rollback restores only first notification: 1'
  );
  await expect(page.locator('#result')).toContainText('DONE: network-only');
});
