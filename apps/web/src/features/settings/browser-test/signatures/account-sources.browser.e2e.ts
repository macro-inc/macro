import { expect, test } from '@playwright/test';

test('account-scoped lists ignore old in-flight channel and inbox responses', async ({
  page,
}) => {
  await page.goto('/?account-sources');
  const inboxes = page.getByTestId('account-inboxes');
  const channels = page.getByTestId('account-channels');
  await expect(inboxes).toHaveText('first@example.com');
  await expect(channels).toHaveText('First channel');
  await expect(page.getByTestId('contact-context-state')).toHaveText('ready');
  await expect(page.getByTestId('contact-context-rows')).toContainText(
    'First channel'
  );
  await page.getByRole('button', { name: 'Hold refresh' }).click();
  await page.evaluate(() => window.signatureFixture.waitForHeldSources());
  await page.getByRole('button', { name: 'Switch account' }).click();
  await expect(inboxes).toHaveText('second@example.com');
  await expect(channels).toHaveText('Second channel');
  await expect(page.getByTestId('contact-context-state')).toHaveText('ready');
  await expect(page.getByTestId('contact-context-rows')).toContainText(
    'macro|other@example.com'
  );
  await expect(page.getByTestId('contact-context-rows')).toContainText(
    'Second channel'
  );
  await page.getByRole('button', { name: 'Release old responses' }).click();
  await page.evaluate(() => window.signatureFixture.waitForReleasedSources());
  expect(
    await page.evaluate(
      () => window.signatureFixture.readState().pendingSourceReads
    )
  ).toBe(0);
  await expect(inboxes).toHaveText('second@example.com');
  await expect(channels).toHaveText('Second channel');
  await expect(page.getByTestId('contact-context-rows')).not.toContainText(
    'First channel'
  );
});
