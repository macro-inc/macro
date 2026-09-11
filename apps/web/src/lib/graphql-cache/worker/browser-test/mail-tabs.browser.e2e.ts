import { expect, test } from '@playwright/test';

test('Drafts, Sent, Calendar and Shared use canonical metadata offline', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await context.setOffline(true);
  const rows = page.locator('#rows li');
  const more = page.getByRole('button', { name: 'Load more cached mail' });
  try {
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('DRAFTS');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('Draft 69');
    await more.click();
    await expect(rows).toHaveCount(20);
    await more.click();
    await expect(rows).toHaveCount(23);
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('SENT');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('Sent 68');
    await more.click();
    await expect(rows).toHaveCount(16);
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('ALL');
    await page
      .getByRole('combobox', { name: 'Calendar', exact: true })
      .selectOption('true');
    await expect(rows).toHaveCount(10);
    await more.click();
    await expect(rows).toHaveCount(14);
    await page
      .getByRole('combobox', { name: 'Calendar', exact: true })
      .selectOption('all');
    await page
      .getByRole('combobox', { name: 'Sharing', exact: true })
      .selectOption('ONLY');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Email 74');
    await expect(rows.last()).toContainText('Email 60');
    await page
      .getByRole('combobox', { name: 'Calendar', exact: true })
      .selectOption('true');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Email 60');
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption('1000');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#result')).toHaveAttribute(
      'data-status',
      'ready'
    );
  } finally {
    await context.setOffline(false);
  }
});
