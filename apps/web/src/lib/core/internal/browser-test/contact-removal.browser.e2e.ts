import { expect, test } from '@playwright/test';

test('backfill verifies missing cached contacts before removal and rejects old hydration', async ({
  page,
}) => {
  await page.goto('/?contact-removal');
  await expect(page.getByTestId('removal-status')).toHaveText('complete', {
    timeout: 20000,
  });
  await expect(page.getByTestId('stored-contacts')).toHaveText('601');
  await page.getByRole('button', { name: 'Remove membership' }).click();
  await expect(page.getByTestId('removal-status')).toHaveText(
    'verification held'
  );
  // All hydration pages completed with this person omitted; that is not deletion evidence.
  await expect(page.getByTestId('stored-contacts')).toHaveText('601');
  await page.getByRole('button', { name: 'Verify membership' }).click();
  await expect(page.getByTestId('removal-status')).toHaveText('complete');
  await expect(page.getByTestId('stored-contacts')).toHaveText('600');
  await page.getByRole('button', { name: 'Apply old hydration' }).click();
  await expect(page.getByTestId('late-hydration')).toContainText(
    'contact write fence changed'
  );
  await expect(page.getByTestId('stored-contacts')).toHaveText('600');
  await page.getByRole('button', { name: 'Restore membership' }).click();
  await expect(page.getByTestId('stored-contacts')).toHaveText('601');
});

test('canceling verification retains the contact and resumes through the same lane', async ({
  page,
}) => {
  await page.goto('/?contact-removal');
  await expect(page.getByTestId('removal-status')).toHaveText('complete', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Remove membership' }).click();
  await expect(page.getByTestId('removal-status')).toHaveText(
    'verification held'
  );
  await page.getByRole('button', { name: 'Cancel verification' }).click();
  await expect(page.getByTestId('removal-status')).toHaveText('canceled');
  await expect(page.getByTestId('stored-contacts')).toHaveText('601');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('removal-status')).toHaveText('complete');
  await expect(page.getByTestId('stored-contacts')).toHaveText('600');
});
