// What the Queued email sends panel (in Drafts) says of each send it lists:
// a send this device holds while it waits for the inbox, for the service or
// for its cancellation; a send another device sees during its Undo window,
// scheduled, unconfirmed, failing to cancel and cancelled elsewhere; a long
// list of sends from elsewhere and a refresh of it that fails; and a record
// in this browser's send journal that this build cannot read.

import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  anotherDevice,
  failOperation,
  holdOperation,
  openSendAttempts,
  panelButton,
  refuseOperation,
  removeUnreadableSendRecord,
  returnToTab,
  sendStatus,
  sendsPanel,
  setSendUnconfirmed,
  unconfirmedSendsElsewhere,
  unreadableSendRecord,
} from './harness/states-send2';
import { did, saw } from './ledger/record';

const SUBJECT = 'Held numbers';
const UNCONFIRMED_HERE =
  'Delivery unconfirmed. Your email may already have been sent. Check your sent mail. We will not resend automatically.';
const UNCONFIRMED_ELSEWHERE =
  'Delivery unconfirmed. Check sent mail; we will not resend automatically.';

test.describe('a send this device holds, in a Gmail inbox', () => {
  // The rows of a send this device holds come from its own journal and the
  // services' answers to it, the same code for either provider: Gmail only.
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a send waiting on this device no longer says what it
  // waits for: one refused until the inbox is reconnected loses that reason
  // or its Cancel and Check status, a resumed one that the service has not
  // confirmed does not say "Checking server acceptance", or one being
  // cancelled does not say "Cancellation pending" and still lets Cancel be
  // pressed.
  test('a send waiting on this device says what it waits for', async ({
    page,
    mailbox,
  }) => {
    // The service answers the send as needing the inbox reconnected; once
    // it is, the service cannot be reached, so acceptance stays unconfirmed.
    let reconnected = false;
    await refuseOperation(
      page,
      'SendEmailMessage',
      'sendEmailMessage',
      { message: 'reconnect this inbox', code: 'NEEDS_REAUTH' },
      () => !reconnected
    );
    await failOperation(page, 'SendEmailMessage', () => reconnected);
    const cancelling = await holdOperation(page, 'CancelEmailSend');

    await composeNew(page, mailbox, {
      to: 'grace@example.com',
      subject: SUBJECT,
      body: 'The numbers are in.',
    });
    await page.getByRole('button', { name: 'Send email' }).click();
    const panel = await sendsPanel(page);
    await expect(panel.getByText(SUBJECT)).toBeVisible();
    await expect(
      sendStatus(
        panel,
        'Reconnect your email account, then check status to resume.'
      )
    ).toBeVisible();
    await expect(panelButton(panel, 'Cancel')).toBeEnabled();
    await expect(panelButton(panel, 'Check status')).toBeEnabled();
    saw('STC-428');

    reconnected = true;
    await panelButton(panel, 'Check status').click();
    did('AC-106');
    await expect(sendStatus(panel, 'Checking server acceptance')).toBeVisible();
    await expect(panelButton(panel, 'Check status')).toHaveCount(0);
    saw('STC-424');

    await panelButton(panel, 'Cancel').click();
    did('AC-104', 'F-136');
    await expect(sendStatus(panel, 'Cancellation pending')).toBeVisible();
    await expect(panelButton(panel, 'Cancel')).toBeDisabled();
    saw('STC-102');

    // The service never held the send: it is cancelled, the draft restored.
    await cancelling.release();
    await expect(panel).toHaveCount(0);
  });
});

for (const provider of PROVIDERS) {
  test.describe(`a send seen on another device during its Undo window, in ${anInbox(provider)}`, () => {
    // Long enough an Undo window that the send waits through the test.
    test.use({ provider, stackEnv: { SENT_UNDO_DELAY_SECS: '120' } });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a device shows the wrong state for a send the
    // service holds: the other device does not list it as scheduled with
    // its time and Cancel and restore, hides why its cancellation failed,
    // either device misses that delivery is unconfirmed (or still offers
    // Cancel for it), or the sending browser does not offer Restore draft
    // for a send cancelled elsewhere.
    test('each device says what the service holds for the send', async ({
      page,
      mailbox,
      browser,
    }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: SUBJECT,
        body: 'The numbers are in.',
      });
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect.poll(() => openSendAttempts(mailbox)).toBe(1);
      const here = await sendsPanel(page);

      const other = await anotherDevice(browser, mailbox);
      try {
        const there = await sendsPanel(other.page);
        await expect(there.getByText(SUBJECT)).toBeVisible();
        const scheduledThere = sendStatus(
          there,
          /^Scheduled · \d+\/\d+\/\d{4}, \d+:\d{2}:\d{2} [AP]M$/
        );
        await expect(scheduledThere).toBeVisible();
        await expect(panelButton(there, 'Cancel and restore')).toBeEnabled();
        saw('STC-429');

        // The service turns the first cancellation away.
        let refusals = 1;
        await refuseOperation(
          other.page,
          'CancelEmailSend',
          'cancelEmailSend',
          { message: 'The service is busy' },
          () => refusals-- > 0
        );
        await panelButton(there, 'Cancel and restore').click();
        did('AC-108', 'F-136');
        await expect(there.getByRole('alert')).toContainText(
          'The service is busy'
        );
        saw('STC-107');

        // The service could not learn whether the provider has it.
        await setSendUnconfirmed(mailbox, true);
        await expect(sendStatus(here, UNCONFIRMED_HERE)).toBeVisible();
        await expect(panelButton(here, 'Check status')).toBeEnabled();
        await expect(panelButton(here, 'Cancel')).toHaveCount(0);
        saw('STC-103');
        await returnToTab(other.page);
        await expect(sendStatus(there, UNCONFIRMED_ELSEWHERE)).toBeVisible();
        await expect(panelButton(there, 'Check status')).toBeEnabled();
        await expect(panelButton(there, 'Cancel and restore')).toHaveCount(0);
        saw('STC-106');

        // It holds it as waiting for its time again; the other device
        // cancels it.
        await setSendUnconfirmed(mailbox, false);
        await panelButton(there, 'Check status').click();
        did('AC-109');
        await expect(scheduledThere).toBeVisible();
        await panelButton(there, 'Cancel and restore').click();
        did('AC-108', 'F-136');
        await expect(there).toHaveCount(0);
      } finally {
        await other.close();
      }

      await expect(sendStatus(here, 'Send cancelled')).toBeVisible();
      await expect(panelButton(here, 'Restore draft')).toBeEnabled();
      saw('STC-101');
      await panelButton(here, 'Restore draft').click();
      did('AC-105');
      await expect(here).toHaveCount(0);
    });
  });
}

test.describe('sends made elsewhere, in a Gmail inbox', () => {
  // The panel pages and refreshes the service's list the same way for
  // either provider: Gmail only.
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a send whose message names no subject has a blank
  // title instead of "(No subject)", a list of sends longer than a page
  // hides the rest with no Load more sends, the button stays once all are
  // listed, or a refresh that cannot reach the service drops the rows or
  // says nothing.
  test('a long list of sends from elsewhere pages, and says when it cannot refresh', async ({
    page,
    mailbox,
  }) => {
    // Sends made elsewhere whose message Macro does not hold: the service
    // lists them with no subject. (This device's composer refuses to send
    // without one, email-composer.ts `no_subject`.)
    await unconfirmedSendsElsewhere(mailbox, 51);
    await mailbox.open('/app/mail');
    const panel = await sendsPanel(page);
    const rows = sendStatus(panel, UNCONFIRMED_ELSEWHERE);
    const more = panelButton(panel, 'Load more sends');
    await expect(rows).toHaveCount(50);
    await expect(panel.getByText('(No subject)', { exact: true })).toHaveCount(
      50
    );
    saw('STC-108');
    await expect(more).toBeEnabled();
    saw('STC-427');
    await more.click();
    did('AC-110');
    await expect(rows).toHaveCount(51);
    await expect(more).toHaveCount(0);

    let unreachable = true;
    await failOperation(page, 'PendingEmailSends', () => unreachable);
    await panelButton(panel, 'Check status').first().click();
    did('AC-109');
    const stale = sendStatus(
      panel,
      'Could not refresh server delivery status. Previously confirmed sends are preserved.'
    );
    await expect(stale).toBeVisible();
    await expect(rows).toHaveCount(51);
    saw('STC-431');
    unreachable = false;
    await panelButton(panel, 'Check status').first().click();
    await expect(stale).toHaveCount(0);
  });

  // When this fails, a send record this build cannot read is dropped
  // without a word (the user may clear storage and lose it), or the
  // warning stays after the record is gone.
  test('a send record this build cannot read is kept and flagged', async ({
    page,
    mailbox,
  }) => {
    await mailbox.open('/app/mail');
    const panel = await sendsPanel(page);
    await expect.poll(() => unreadableSendRecord(page)).toBe(true);
    await expect(panel.getByRole('alert')).toHaveText(
      'A saved email needs recovery. Its contents are preserved on this device. Contact support before clearing storage.'
    );
    saw('STC-430');
    await removeUnreadableSendRecord(page);
    await expect(panel).toHaveCount(0);
  });
});
