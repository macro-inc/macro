// A draft changed in the mailbox (by the provider's own client) while Macro
// was saving it: the notice above the composer asks which version to keep.
// Keep Macro version writes Macro's copy over the mailbox's; Use mailbox
// version takes the mailbox's, and Reload draft shows it.
//
// Outlook only: Macro writes its drafts into the mailbox only for Outlook
// (crates/email/src/outbound/mailbox_pg/drafts.rs, the `l.provider =
// 'OUTLOOK'` claim); a Gmail inbox's drafts stay in Macro, so its mailbox
// has no copy of Macro's draft to change.

import type { Page } from '@playwright/test';
import {
  body,
  composeNew,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { draftAtProvider, editDraftAtProvider } from './harness/ways-send-more';
import { did } from './ledger/record';

const CONFLICT = 'This draft changed in your mailbox.';

/** A saved draft edited in the mailbox and then in Macro, until they conflict. */
async function conflicted(page: Page, mailbox: Mailbox, subject: string) {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'Thinking of the coast.',
  });
  await routeDraftId(page);
  await expect
    .poll(async () => (await draftAtProvider(mailbox, subject))?.body)
    .toContain('Thinking of the coast.');
  await editDraftAtProvider(mailbox, subject, 'From the phone.');
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Or the hills.');
  const notice = page.getByRole('status').filter({ hasText: CONFLICT });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  return notice;
}

test.describe('a draft changed in the mailbox while Macro saved it, in an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, confirming Keep Macro version leaves the mailbox's copy
  // at the provider (or the conflict notice on screen) instead of writing
  // Macro's copy over it.
  test('Keep Macro version, confirmed, writes Macro’s copy to the mailbox', async ({
    page,
    mailbox,
  }) => {
    const notice = await conflicted(page, mailbox, 'Offsite plan');
    await notice
      .getByRole('button', { name: 'Keep Macro version', exact: true })
      .click();
    await expect(notice).toContainText(
      'Replace the mailbox draft with the saved Macro version?'
    );
    await notice.getByRole('button', { name: 'Confirm', exact: true }).click();
    did('AL-190', 'F-120');
    await expect
      .poll(async () => (await draftAtProvider(mailbox, 'Offsite plan'))?.body)
      .toContain('Thinking of the coast.');
    expect(
      (await draftAtProvider(mailbox, 'Offsite plan'))?.body
    ).not.toContain('From the phone.');
    await expect(page.getByText(CONFLICT)).toHaveCount(0);
  });

  // When this fails, after Use mailbox version the notice never offers Reload
  // draft, or Reload draft leaves Macro's text in the composer instead of the
  // mailbox's.
  test('Use mailbox version, confirmed, and Reload draft shows the mailbox’s copy', async ({
    page,
    mailbox,
  }) => {
    const notice = await conflicted(page, mailbox, 'Offsite plan');
    await notice
      .getByRole('button', { name: 'Use mailbox version', exact: true })
      .click();
    await expect(notice).toContainText(
      'Replace the saved Macro draft with the mailbox version?'
    );
    await notice.getByRole('button', { name: 'Confirm', exact: true }).click();
    did('AL-190', 'F-120');
    const ready = page
      .getByRole('status')
      .filter({ hasText: 'The mailbox version is ready.' });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await ready.getByRole('button', { name: 'Reload draft' }).click();
    did('AC-402');
    await expect(body(page)).toHaveText('From the phone.');
  });
});
