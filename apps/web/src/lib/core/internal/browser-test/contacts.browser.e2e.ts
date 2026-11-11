import { expect, test } from '@playwright/test';

test('bounds pages and search history, preserves target IDs, and isolates accounts', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('[data-contact-id]');
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveAttribute(
    'data-contact-id',
    'macro|account-a-0@example.com'
  );
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveAttribute(
    'data-contact-id',
    'macro|account-a-50@example.com'
  );
  await page.getByRole('textbox', { name: 'Search contacts' }).fill('rare');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Rare person');
  await expect(rows.first()).toHaveAttribute(
    'data-contact-id',
    'macro|account-a-99999@example.com'
  );
  await expect(page.getByTestId('query-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(rows.first()).toHaveAttribute(
    'data-contact-id',
    'macro|account-b-99999@example.com'
  );
  await expect(
    page.locator('[data-contact-id^="macro|account-a"]')
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('keeps online and offline partial results local', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-contact-id]')).toHaveCount(50);
  await page.getByRole('button', { name: 'Partial cache' }).click();
  await expect(page.getByRole('status')).toContainText('partial');
  await expect(page.getByRole('status')).toContainText('Local contacts');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('[data-contact-id]')).toHaveCount(50);
  await expect(page.locator('[data-contact-id]').first()).toHaveAttribute(
    'data-contact-id',
    'macro|account-a-50@example.com'
  );
  await page.getByRole('button', { name: 'Offline partial' }).click();
  await expect(page.getByRole('status')).toContainText('partial');
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.locator('[data-contact-id]')).toHaveCount(1);
});
