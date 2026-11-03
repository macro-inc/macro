import { expect, test } from '@playwright/test';

test('a finished reply can be made into a doc', async ({ page }) => {
  await page.goto('/mentions.html');
  const reply = page.getByRole('region', { name: 'Agent reply' });
  await expect(reply).toContainText('Project notes', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Make a doc' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop response' }).click();
  const make = page.getByRole('button', { name: 'Make a doc' });
  await expect(make).toBeVisible();
  await make.click();
  await expect(make).toHaveAttribute(
    'data-opened-document',
    'fixture-document'
  );
});
