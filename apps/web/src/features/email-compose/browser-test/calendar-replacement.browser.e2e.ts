import { expect, type Page, test } from '@playwright/test';

async function confirmAndRecover(page: Page) {
  await page.goto('/?calendar-replacement');
  await page
    .getByRole('button', { name: 'Replace event…', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Review replacement' }).click();
  await expect(page.getByTestId('replacement-actions')).toHaveText('preview');
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
  await expect(
    page.getByRole('button', { name: 'Change options' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Replace event…', exact: true })
    .click();
  await page.getByRole('button', { name: 'Check progress' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    'Replacement complete'
  );
  await expect(page.getByTestId('replacement-actions')).toHaveText(
    'preview,confirm:saved-operation,check:saved-operation'
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
