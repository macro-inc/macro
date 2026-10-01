import { expect, test } from '@playwright/test';

test('query-page writes stay quiet while shared entity changes refresh readers', async ({
  page,
}) => {
  await page.goto('query-write-scope.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: 'Add unrelated query page' }).click();
  await expect(result).toHaveAttribute('data-status', 'passed');
  expect(JSON.parse((await result.textContent())!)).toEqual({
    affected: [],
    searchRefreshes: 0,
    names: ['Original', 'Original'],
  });
  await page.getByRole('button', { name: 'Rename shared document' }).click();
  await expect(result).toContainText('Renamed');
  expect(JSON.parse((await result.textContent())!)).toEqual({
    affected: [[1, 2]],
    searchRefreshes: 1,
    names: ['Renamed', 'Renamed'],
  });
});
