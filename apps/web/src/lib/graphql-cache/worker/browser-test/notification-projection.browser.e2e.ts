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
    'Secondary edges preserve local filtering: 1'
  );
  for (const kind of ['DOCUMENT', 'PROJECT', 'CHAT']) {
    for (const operation of ['inbox update', 'optimism', 'deletion']) {
      await expect(page.locator('#result')).toContainText(
        `Unhydrated ${kind} ${operation}: 1`
      );
    }
  }
  await expect(page.locator('#result')).toContainText(
    'Rollback restores only first notification: 1'
  );
  await expect(page.locator('#result')).toContainText('DONE: network-only');
  await expect(page.locator('#result')).toContainText(
    'Write identity switch discards old associations: 1'
  );
  await expect(page.locator('#result')).toContainText(
    'Hydration identity switch discards old associations: 1'
  );
  await expect(page.locator('#result')).toContainText(
    'Identity-only notification cannot inherit a parent: 0'
  );
});
