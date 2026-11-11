import { expect, test } from '@playwright/test';

test('filters automated user suggestions but accepts their complete typed address', async ({
  page,
}) => {
  await page.goto('/?recipient-ranking');
  const input = page.getByRole('combobox');
  await input.fill('notifications');
  await expect(page.getByRole('option')).toHaveCount(0);
  await input.fill('notifications@example.com');
  await expect(page.getByRole('option').first()).toContainText(
    'notifications@example.com'
  );
  await input.press('Enter');
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|notifications@example.com"]'
  );
});

test('exact recipient addresses beat recent word matches and retain selection across searches', async ({
  page,
}) => {
  await page.goto('/?recipient-ranking');
  const input = page.locator('input[type="text"]').first();
  await input.fill('person@example.com');
  await expect(page.getByRole('option').first()).toContainText(
    'person@example.com'
  );
  await input.press('Enter');
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|person@example.com"]'
  );
  await input.fill('recent');
  await expect(page.getByRole('option').first()).toContainText(
    'recent@example.com'
  );
  await expect(page.getByTestId('recipients')).toHaveText(
    '["macro|person@example.com"]'
  );
});
