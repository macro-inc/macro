// What the composer says above a draft that changed in the mailbox while
// Macro saved it: which version to keep, and, once the mailbox's is taken,
// that it is ready to reload.
//
// Outlook only: Macro writes its drafts into the mailbox only for Outlook
// (crates/email/src/outbound/mailbox_pg/drafts.rs, the `l.provider =
// 'OUTLOOK'` claim); a Gmail inbox's drafts stay in Macro, so there is no
// mailbox copy to change.

import {
  body,
  composeNew,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { editMailboxDraft, mailboxDraft } from './harness/states-send2';
import { saw } from './ledger/record';

const CONFLICT =
  'This draft changed in your mailbox. Choose which version to keep. Either choice cancels scheduled delivery.';
const READY =
  'The mailbox version is ready. Reload the draft to continue editing.';

test.use({ provider: 'OUTLOOK' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, a draft edited in the mailbox and in Macro at once shows
// no notice above the composer, or the notice offers no way to keep either
// version, or after taking the mailbox's version it never says it is ready
// to reload.
test('a draft changed in the mailbox says which version to keep, then that the mailbox’s is ready', async ({
  page,
  mailbox,
}) => {
  const subject = 'Retreat plan';
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'Thinking of the coast.',
  });
  await routeDraftId(page);
  await expect
    .poll(async () => (await mailboxDraft(mailbox, subject))?.body)
    .toContain('Thinking of the coast.');
  await editMailboxDraft(mailbox, subject, 'From the phone.');
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Or the hills.');

  const notice = page.getByRole('status').filter({ hasText: CONFLICT });
  // The service learns of the conflict on its next write to the mailbox.
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(
    notice.getByRole('button', { name: 'Keep Macro version', exact: true })
  ).toBeVisible();
  await expect(
    notice.getByRole('button', { name: 'Use mailbox version', exact: true })
  ).toBeVisible();
  saw('STC-111');

  await notice
    .getByRole('button', { name: 'Use mailbox version', exact: true })
    .click();
  await notice.getByRole('button', { name: 'Confirm', exact: true }).click();
  const ready = page.getByRole('status').filter({ hasText: READY });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await expect(
    ready.getByRole('button', { name: 'Reload draft', exact: true })
  ).toBeVisible();
});
