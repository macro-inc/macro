import { expect, test } from '@playwright/test';

test('routes scoped references through the real retiring host and OPFS engine', async ({
  page,
}) => {
  await page.goto('/people-references.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', /passed|failed/);
  expect(
    await result.getAttribute('data-status'),
    (await result.textContent()) ?? 'No result'
  ).toBe('passed');
  await expect(result).toContainText('"witnesses":[2,1,0]');
});
