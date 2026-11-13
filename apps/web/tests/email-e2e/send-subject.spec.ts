import { expect, test } from './harness/fixtures';

test.describe('a subject longer than Exchange keeps', () => {
  test.use({ provider: 'OUTLOOK' });

  // Class outlook-subject-over-255: Exchange stores 255 characters of a
  // subject. When this fails nothing tells the sender, and the message goes
  // out with its subject cut.
  test('is flagged in the composer of an Outlook inbox', async ({
    page,
    mailbox,
  }) => {
    await mailbox.open('/app/mail');
    await page
      .getByRole('complementary', { name: 'Email navigation' })
      .getByLabel('New email')
      .click();
    const subject = page.getByRole('textbox', { name: 'Subject' });

    await subject.fill('x'.repeat(255));
    await expect(subject).toHaveValue('x'.repeat(255));
    await expect(page.getByText(/Outlook allows 255/)).toHaveCount(0);

    await subject.fill('x'.repeat(300));
    await expect(
      page.getByText('Subject is 300 characters. Outlook allows 255.')
    ).toBeVisible();
    await expect(subject).toHaveAttribute('aria-invalid', 'true');
  });
});
