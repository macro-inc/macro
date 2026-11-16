import { expect, test } from '@playwright/test';

test('inline task filters resolve only referenced names in bounded batches and release old references', async ({
  page,
}) => {
  await page.goto('/?task-list-labels');
  await expect(page.getByTestId('inline-names')).toHaveText(
    '["Person 0","Person 500","Unknown"]'
  );
  expect(
    JSON.parse(
      (await page.getByTestId('inline-lookup-sizes').textContent()) ?? '[]'
    ).sort((a: number, b: number) => a - b)
  ).toEqual([1, 500]);
  await expect(page.getByTestId('inline-lookup-ids')).not.toContainText(
    'invalid-user'
  );
  await page.getByRole('button', { name: 'Filter tasks', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Assignee', exact: true }).click();
  const search = page.getByPlaceholder('Search assignees...');
  await search.fill('Person 500');
  const option = page.getByRole('option', { name: 'Person 500', exact: true });
  await expect(option).toBeVisible();
  await option.locator('[data-multiselect-checkbox]').click();
  await expect(page.getByTestId('inline-settings')).toContainText(
    'macro|person500@example.com'
  );
  await search.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Replace references' }).click();
  await expect(page.getByTestId('inline-names')).toHaveText(
    '["Unknown","Unknown","Person 999"]'
  );
  // Scoped roster changes never erase the saved filter identity.
  await expect(page.getByTestId('inline-settings')).toContainText(
    'macro|person500@example.com'
  );
  await expect(page.getByTestId('inline-lookup-ids')).toHaveText(
    '["macro|person999@example.com"]'
  );
});
