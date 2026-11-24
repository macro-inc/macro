// A send from an Outlook inbox whose draft changes in the mailbox while the
// send waits. Outlook only: Macro writes its drafts into the mailbox only for
// Outlook, so there is no mailbox copy to change elsewhere.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { injectFault, notice, onlySentRaw, sentMessages } from './harness/send';
import {
  categorizeMailboxDraft,
  editMailboxDraft,
  mailboxDraft,
  panelButton,
  sendStatus,
} from './harness/states-send2';
import { phoneRecipientInput } from './harness/ways-compose-more';
import { openPhoneComposer, phone, phoneBody } from './harness/ways-compose1';
import { confirmed, did, saw } from './ledger/record';

const SUBJECT = 'Retreat plan';
const TEXT = 'Thinking of the coast.';
const FAILED =
  'Send failed before delivery. This draft changed in your mailbox. Cancel to recover it, then choose which version to keep.';
const CONFLICT =
  'This draft changed in your mailbox. Choose which version to keep. Either choice cancels scheduled delivery.';

async function composeOnPhone(page: Page, mailbox: Mailbox): Promise<void> {
  await openPhoneComposer(page, mailbox);
  const to = phoneRecipientInput(page, 'To');
  await to.fill('grace@example.com');
  await to.press('Enter');
  // To takes the focus back once its suggestions have closed.
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Subject' }).fill(SUBJECT);
  await phoneBody(page).tap();
  await page.keyboard.type(TEXT);
}

for (const layout of ['desktop', 'phone'] as const) {
  test.describe(`a draft changed in the mailbox while its send waits, on a ${layout}`, () => {
    test.use({
      provider: 'OUTLOOK',
      // Long enough to change the draft in the mailbox before the server sends.
      stackEnv: { SENT_UNDO_DELAY_SECS: '6' },
      ...(layout === 'phone' ? phone : {}),
    });
    test.beforeEach(async ({ page, mailbox }) => {
      await loadAppSteadily(page);
      if (layout === 'phone') await composeOnPhone(page, mailbox);
      else
        await composeNew(page, mailbox, {
          to: 'grace@example.com',
          subject: SUBJECT,
          body: TEXT,
        });
      await expect
        .poll(async () => (await mailboxDraft(mailbox, SUBJECT))?.body)
        .toContain(TEXT);
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Sending…')).toBeVisible();
    });

    // When this fails, a draft whose version moved in the mailbox without an
    // edit, as Outlook and the tools around it move it, no longer goes out.
    test('a change that is not an edit does not stop the send', async ({
      page,
      mailbox,
    }) => {
      await categorizeMailboxDraft(mailbox, SUBJECT, 'Travel');

      await expect(notice(page, 'Email sent')).toBeVisible({ timeout: 30_000 });
      const raw = await onlySentRaw(mailbox);
      expect(raw).toContain(TEXT);
      confirmed('F-132');
      await expect(page.getByLabel('Queued email sends')).toHaveCount(0);
    });

    // When this fails, an edit made in Outlook is sent or overwritten, the
    // person is not told why the send failed, or Cancel does not bring the
    // draft back with both versions to choose from.
    test('an edit stops the send, says so, and leaves both versions to choose from', async ({
      page,
      mailbox,
    }) => {
      await editMailboxDraft(mailbox, SUBJECT, 'From the phone.');

      const sends = page.getByLabel('Queued email sends');
      await expect(sendStatus(sends, FAILED)).toBeVisible({ timeout: 30_000 });
      saw('STC-984');
      expect(await sentMessages(mailbox)).toEqual([]);
      expect((await mailboxDraft(mailbox, SUBJECT))?.body).toContain(
        'From the phone.'
      );
      confirmed('F-136');

      await panelButton(sends, 'Cancel').click();
      did('AC-104', 'F-136');
      await expect(sendStatus(sends, FAILED)).toHaveCount(0);
      await expect(page.getByText(TEXT)).toBeVisible();
      const choice = page.getByRole('status').filter({ hasText: CONFLICT });
      await expect(
        choice.getByRole('button', { name: 'Keep Macro version', exact: true })
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        choice.getByRole('button', { name: 'Use mailbox version', exact: true })
      ).toBeVisible();
      saw('STC-111');
    });
  });
}

for (const { refusal, error, status, row } of [
  {
    refusal: 'no longer gives access',
    error: 'forbidden',
    status:
      'Send failed before delivery. Access to this inbox has changed. Cancel to recover this draft.',
    row: 'STC-986',
  },
  {
    refusal: 'does not take the draft',
    error: 'invalid_operation',
    status:
      'Send failed before delivery. Your mail provider could not save this draft. Cancel to recover it and edit the message or attachments.',
    row: 'STC-987',
  },
]) {
  test.describe(`a send whose mailbox ${refusal}`, () => {
    test.use({
      provider: 'OUTLOOK',
      stackEnv: { SENT_UNDO_DELAY_SECS: '4' },
    });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a send Outlook would not let Macro write does not say
    // why, or goes out all the same.
    test('says why the send failed', async ({ page, mailbox }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: SUBJECT,
        body: TEXT,
      });
      await expect
        .poll(async () => (await mailboxDraft(mailbox, SUBJECT))?.body)
        .toContain(TEXT);
      await injectFault(mailbox, { route: 'messages.update', error });
      await page.getByRole('button', { name: 'Send email' }).click();

      const sends = page.getByLabel('Queued email sends');
      await expect(sendStatus(sends, status)).toBeVisible({ timeout: 30_000 });
      saw(row);
      expect(await sentMessages(mailbox)).toEqual([]);
    });
  });
}
