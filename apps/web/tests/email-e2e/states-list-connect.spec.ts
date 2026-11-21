// What the mail view shows once its only inbox was removed: the invitation
// to connect one.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { emptyTitle } from './harness/states-list';
import { did, saw } from './ledger/record';

const SETTINGS = '/app/mail/~/settings/email';

// Gmail only: with no inbox left, nothing of a provider is on screen.
test.describe('the mail view of a user whose only Gmail inbox was removed', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, removing the last inbox in Settings leaves the mail view
  // without its invitation to connect email, or without the button that
  // starts it.
  test('the mail view asks to connect email', async ({ page, mailbox }) => {
    await mailbox.open(SETTINGS);
    await page
      .getByRole('button', { name: `Remove ${mailbox.inbox.email}` })
      .click();
    did('AX-010');
    await page
      .getByRole('dialog', { name: 'Remove inbox' })
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    did('AX-011');
    await expect(
      page.getByRole('button', { name: `Remove ${mailbox.inbox.email}` })
    ).toHaveCount(0);

    await mailbox.open('/app/mail');
    await expect(emptyTitle(page, 'Connect your email')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Connect email' })
    ).toBeVisible();
    saw('STL-004');
  });
});
