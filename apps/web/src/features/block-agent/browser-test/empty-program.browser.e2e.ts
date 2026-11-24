import { expect, test } from '@playwright/test';

test('a program that failed before naming a step shows no row or count', async ({
  page,
}) => {
  await page.goto('/empty-program.html');
  const alone = page.getByRole('region', { name: 'Program alone' });
  // The dev server transforms the app's modules on first load.
  await expect(alone).toContainText("I couldn't search your mail", {
    timeout: 30_000,
  });
  // Alone in its run: no group, no row, no count.
  await expect(alone.getByRole('button', { name: /Used/ })).toHaveCount(0);
  await expect(alone.getByTestId('tool-card')).toHaveCount(0);
  await expect(alone).not.toContainText(
    /Workspace activity|A step failed|tool/
  );

  // Beside named steps: the group counts only those.
  const mixed = page.getByRole('region', { name: 'Program beside steps' });
  const group = mixed.getByRole('button', { name: /^Used \d+ tools?/ });
  await expect(group).toHaveText('Used 2 tools');
  await group.click();
  const calls = mixed.getByRole('region', { name: 'Tool calls' });
  await expect(calls).toContainText('Search email');
  await expect(calls).toContainText('Read email thread');
  await expect(calls).not.toContainText(/Workspace activity|A step failed/);
  await expect(calls.locator('[data-tool-status]')).toHaveCount(2);

  // A channel reply leaves it out the same way.
  const channel = page.getByRole('region', { name: 'Channel reply' });
  await expect(channel).toContainText("I couldn't search your mail");
  await expect(channel.getByRole('button')).toHaveCount(0);
  await expect(channel).not.toContainText(/A step failed|tool/);
});
