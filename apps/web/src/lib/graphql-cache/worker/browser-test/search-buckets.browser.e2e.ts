import { expect, test } from '@playwright/test';

test('bucket-scoped cold/warm searches keep deterministic results with a large excluded bucket', async ({
  page,
}) => {
  await page.goto('search-buckets.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: 'Run scoped searches' }).click();
  await expect(result).toHaveAttribute('data-status', 'passed');
  const data = JSON.parse((await result.textContent())!);
  expect(data.cold).toEqual(
    Array.from(
      { length: 20 },
      (_, index) => `GraphqlSoupDocument:item-${String(index).padStart(5, '0')}`
    )
  );
  expect(data.email).toEqual(
    Array.from(
      { length: 20 },
      (_, index) =>
        `GraphqlSoupEmailThread:item-${String(index + 100).padStart(5, '0')}`
    )
  );
  expect(data.all).toEqual(data.cold);
  // Timings are diagnostic, not flaky wall-clock assertions.
  expect(data.measurements).toHaveLength(8);
});
