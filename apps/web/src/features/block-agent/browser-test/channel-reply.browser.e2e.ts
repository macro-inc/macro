import { expect, test } from '@playwright/test';

test("a channel reply's run counts its steps and never names a failure", async ({
  page,
}) => {
  await page.goto('/channel-reply.html');
  const reply = page.getByRole('region', { name: 'Agent reply' });
  const summary = reply.getByRole('button', { name: 'Used 4 tools' });
  // The dev server transforms the app's modules on first load.
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).not.toContainText(/failed/i);
  await expect(reply.locator('.text-failure')).toHaveCount(0);

  await summary.click();
  const steps = reply.getByRole('list', { name: 'Steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(4);
  // How each step ended stays in the data, unshown.
  await expect(steps.locator('[data-status="failed"]')).toContainText(
    'Update task'
  );
  await expect(steps.locator('[data-status="interrupted"]')).toContainText(
    'Read task'
  );
  await expect(steps).not.toContainText(/failed|interrupted/i);
  await expect(reply.locator('.text-failure')).toHaveCount(0);
});
