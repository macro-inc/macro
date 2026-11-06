import { expect, test } from '@playwright/test';

test('holds rows and section geometry until catch-up', async ({ page }) => {
  await page.goto('/');
  const list = page.locator('[data-agent-activity-list]');
  const below = page.locator('[data-below-section]');
  await expect(list.locator('[data-agent-activity-item]')).toHaveCount(12);
  const initial = await below.boundingBox();
  expect(initial).not.toBeNull();
  const box = await list.boundingBox();
  expect(box?.height).toBe(300);

  await list.hover();
  await page
    .getByRole('button', { name: 'Update document 3' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.getByRole('button', { name: '1 new' })).toBeVisible();
  await expect(
    list.locator('[data-agent-activity-item]').first()
  ).toContainText('Document 12');
  await page.getByRole('button', { name: '1 new' }).click();
  await expect(
    list.locator('[data-agent-activity-item]').first()
  ).toContainText('Document 3');
  await expect(
    page.getByRole('button', { name: 'Show activity for Document 3' })
  ).toHaveAttribute('aria-expanded', 'true');
  expect((await below.boundingBox())?.y).toBe(initial?.y);
});
