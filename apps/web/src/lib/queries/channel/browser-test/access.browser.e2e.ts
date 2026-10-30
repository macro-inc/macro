import { expect, test } from '@playwright/test';

test('stale cache changes retain the conversation while fresh membership changes take effect', async ({
  page,
}) => {
  await page.goto('/');
  let completed = 0;
  const act = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('status', { name: 'Completed actions' })
    ).toHaveText(String(++completed));
  };
  await act('Server allows opening');
  const draft = page.getByRole('textbox', { name: 'Message draft' });
  await draft.fill('Draft survives cache lag');
  await act('Cache empty');
  await expect(draft).toHaveValue('Draft survives cache lag');
  await expect(
    page.getByRole('status', { name: 'State history' })
  ).not.toContainText('unavailable');
  await act('Confirm access');
  await act('Cache empty');
  await expect(draft).toHaveValue('Draft survives cache lag');
  await page.screenshot({
    path: `/tmp/channel-flicker-${test.info().project.name}.png`,
  });
  await act('Server removes access');
  await expect(
    page.getByRole('heading', { name: 'Conversation unavailable' })
  ).toBeVisible();
  await act('Cache has channel');
  await expect(draft).toHaveCount(0);
  await act('Membership restored');
  await expect(draft).toBeVisible();
  await expect(page.getByRole('status', { name: 'Fixture error' })).toBeEmpty();
});
