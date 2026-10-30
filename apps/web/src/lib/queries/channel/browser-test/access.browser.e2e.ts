import { expect, test } from '@playwright/test';

test('stale cache changes retain the conversation while fresh membership changes take effect', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Server allows opening' }).click();
  const draft = page.getByRole('textbox', { name: 'Message draft' });
  await draft.fill('Draft survives cache lag');
  await page.getByRole('button', { name: 'Cache empty', exact: true }).click();
  await expect(draft).toHaveValue('Draft survives cache lag');
  await expect(
    page.getByRole('status', { name: 'State history' })
  ).not.toContainText('unavailable');
  await page
    .getByRole('button', { name: 'Confirm access', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cache empty', exact: true }).click();
  await expect(draft).toHaveValue('Draft survives cache lag');
  await page.screenshot({
    path: `/tmp/channel-flicker-${test.info().project.name}.png`,
  });
  await page.getByRole('button', { name: 'Server removes access' }).click();
  await expect(
    page.getByRole('heading', { name: 'Conversation unavailable' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cache has channel' }).click();
  await expect(draft).toHaveCount(0);
  await page.getByRole('button', { name: 'Membership restored' }).click();
  await expect(draft).toBeVisible();
  await expect(page.getByRole('status', { name: 'Fixture error' })).toBeEmpty();
});
