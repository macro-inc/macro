import { expect, test } from '@playwright/test';

test('stale cache changes and server faults retain the conversation while fresh membership changes take effect', async ({
  page,
}) => {
  // Background refreshes wait while the browser reports itself offline, which
  // it does in a network namespace with only loopback.
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => true })
  );
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
  // A server fault is not a refusal: the conversation stays, and the
  // background refresh retries on its own until the server answers.
  await act('Server fails');
  await expect(draft).toHaveValue('Draft survives cache lag');
  await act('Server retry succeeds');
  await expect(draft).toHaveValue('Draft survives cache lag');
  await expect(
    page.getByRole('status', { name: 'State history' })
  ).not.toContainText('unavailable');
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
