import { expect, test } from '@playwright/test';

test('new Mail filter combinations and pagination work offline without bodies or server baselines', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await expect(page.locator('#rows li')).toHaveCount(10);
  await context.setOffline(true);
  try {
    for (const count of [20, 30, 40, 50, 60, 69]) {
      await page.getByRole('button', { name: 'Load more cached mail' }).click();
      await expect(page.locator('#rows li')).toHaveCount(count);
    }
    await expect(
      page.getByRole('button', { name: 'Load more cached mail' })
    ).toBeDisabled();
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('INBOX');
    await page
      .getByRole('combobox', { name: 'Signal', exact: true })
      .selectOption('true');
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption('1001');
    await expect(page.locator('#rows li')).toHaveCount(3);
    await page
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('ALL');
    await expect(page.locator('#rows li')).toHaveCount(4);
    await expect(page.locator('#rows li')).toHaveText([
      / — Done$/,
      / — Done$/,
      / — Done$/,
      / — Done$/,
    ]);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('true');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(4);
  } finally {
    await context.setOffline(false);
  }
});
