import { expect, type Page, test } from '@playwright/test';

async function confirmAndRecover(page: Page) {
  await page.goto('/?calendar-replacement');
  await page
    .getByRole('button', { name: 'Replace event…', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // The preview shows the unsaved edits the replacement carries.
  await expect(
    page.getByText('Weekly review, moved', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('replacement-actions')).toHaveText(
    'preview:Weekly review, moved'
  );
  const confirm = page.getByRole('button', {
    name: 'Replace event',
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(
    page.getByText('Entire recurring series', { exact: true })
  ).toBeVisible();
  await page
    .getByRole('checkbox', {
      name: 'I understand this cancels the old invitation and sends a new one.',
    })
    .check();
  await confirm.click();
  await expect(page.getByRole('alert')).toContainText('interrupted');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Reopening asks how the confirmed operation is doing instead of
  // preparing another.
  await page
    .getByRole('button', { name: 'Replace event…', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('status')
      .filter({ hasText: 'Replacement complete' })
  ).toBeVisible();
  await expect(page.getByTestId('replacement-actions')).toHaveText(
    'preview:Weekly review, moved,confirm:saved-operation,check:saved-operation'
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('replacement explicitly confirms cancellation and recovers the same operation', async ({
  page,
}) => {
  await confirmAndRecover(page);
});
test.describe('mobile replacement confirmation', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });
  test('preserves the warning and recovery controls on a small screen', async ({
    page,
  }) => {
    await confirmAndRecover(page);
  });
});
