import { expect, test } from '@playwright/test';

test('holds rows and section geometry until catch-up', async ({ page }) => {
  await page.goto('/');
  // On touch the floating panel is a sheet that starts closed.
  const show = page.getByRole('button', { name: 'Show details' });
  if (await show.isVisible()) await show.click();
  const list = page.locator('[data-agent-activity-list]');
  const below = page.locator('[data-below-section]');
  await expect(list.locator('[data-agent-activity-item]')).toHaveCount(12);
  // Measured from the list, since a touch sheet may still be sliding in.
  const gap = async () =>
    Math.round(
      ((await below.boundingBox())?.y ?? 0) -
        ((await list.boundingBox())?.y ?? 0)
    );
  const initial = await gap();
  const box = await list.boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(300);

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
  expect(await gap()).toBe(initial);
});
