// What signing out says about the sends and drafts this device holds: a
// send not yet sent, and drafts it could not check.
//
// Gmail only: the question reads this browser's own storage, the same for
// either provider.

import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { holdOperation } from './harness/states-send2';
import { did, saw } from './ledger/record';

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, signing out with a send still on this device, or with
// draft storage that cannot be read, does not warn what happens to the send
// and the drafts, or Cancel in the question signs the user out anyway.
test('signing out warns about a send not yet sent and about drafts it could not check', async ({
  page,
  mailbox,
}) => {
  // The send never reaches the service, so it stays on this device.
  await holdOperation(page, 'SendEmailMessage');
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: 'Still on its way',
    body: 'The numbers are in.',
  });
  await page.getByRole('button', { name: 'Send email' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Sending/ })
  ).toBeVisible();

  await mailbox.open('/app/mail/~/settings/account');
  const logOut = page.getByRole('button', { name: 'Log out', exact: true });
  const dialog = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .filter({ hasText: 'Sign out and remove local drafts?' });
  await logOut.click();
  await expect(dialog).toContainText(
    'Pending sends remain saved for this account and resume when you sign in again. Sends already accepted by the server may still be delivered; signing out does not cancel them.'
  );
  saw('STC-432');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  did('AC-401');
  await expect(dialog).toHaveCount(0);

  // Draft storage that refuses every read, as a broken browser profile does.
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = () => {
      throw new DOMException('Storage is broken', 'UnknownError');
    };
  });
  await logOut.click();
  await expect(dialog).toContainText(
    'Draft storage could not be checked. Signing out removes unsubmitted drafts and their pending attachments.'
  );
  saw('STC-433');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(logOut).toBeVisible();
});
