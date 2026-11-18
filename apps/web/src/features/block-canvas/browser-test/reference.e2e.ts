import { expect, test } from '@playwright/test';

test('loads a saved canvas and opens its reference', async ({ page }) => {
  await page.goto('/reference.html');
  const reference = page.getByTestId('canvas-reference');
  await expect(reference).toBeVisible();
  await reference.click();
  expect(await page.evaluate(() => window.referenceFixture.opens)).toBe(1);
});

test('editable canvas mounts and opens its reference', async ({ page }) => {
  await page.goto('/reference.html?edit');
  const reference = page.getByTestId('canvas-reference');
  await expect(reference).toBeVisible();
  await reference.click();
  expect(await page.evaluate(() => window.referenceFixture.opens)).toBe(1);
});
