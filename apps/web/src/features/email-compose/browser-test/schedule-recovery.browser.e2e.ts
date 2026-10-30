import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  const surface = mobile ? 'mobile summary' : 'desktop bar';
  test(`${surface} restores a failed scheduled send without resending`, async ({
    page,
  }) => {
    await page.goto(
      `/?scheduled-recovery&status=failed${mobile ? '&mobile' : ''}`
    );
    await expect(page.getByTestId('schedule-summary-label')).toContainText(
      'Send failed before delivery'
    );
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: /Send time cannot be changed/ })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Send email', exact: true })
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Restore failed scheduled draft' })
      .click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Preserve this scheduled message'
    );
    await expect(page.getByTestId('cancel-count')).toHaveText('1');
    await expect(page.getByTestId('send-count')).toHaveText('0');
  });

  test(`${surface} checks an uncertain send and keeps delivery locked`, async ({
    page,
  }) => {
    await page.goto(
      `/?scheduled-recovery&status=unconfirmed${mobile ? '&mobile' : ''}`
    );
    await expect(page.getByTestId('schedule-summary-label')).toContainText(
      'We will not resend automatically'
    );
    await expect(
      page.getByRole('button', { name: /Send time cannot be changed/ })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: /cancel|restore/i })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Check delivery status' }).click();
    await expect(page.getByTestId('check-count')).toHaveText('1');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await expect(page.getByTestId('cancel-count')).toHaveText('0');
    await expect(page.getByTestId('send-count')).toHaveText('0');
  });
}
