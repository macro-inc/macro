// What the send queue says in two states that take more than one request
// going wrong: an Undo the service confirms while this browser cannot read
// back what became of the send, and a reply that waits on this device for
// the reply it answers, which is still on its way.

import type { Locator, Page } from '@playwright/test';
import {
  composeNew,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice, replyEditor } from './harness/send';
import {
  failOperation,
  holdOperation,
  openSendAttempts,
  panelButton,
  sendStatus,
  sendsPanel,
} from './harness/states-send2';
import { saw } from './ledger/record';

/** Waits for the next answer the services give the GraphQL operation `name`. */
function answered(page: Page, name: string): Promise<unknown> {
  return page.waitForResponse(
    (response) => graphqlOperation(response.request()) === name && response.ok()
  );
}

/** Writes a reply in the open thread and presses Send. */
async function sendReply(page: Page, text: string): Promise<void> {
  await page.getByText('Reply...').click();
  await replyEditor(page).pressSequentially(text);
  await page.getByRole('button', { name: 'Send email' }).click();
  await expect(replyEditor(page)).toHaveCount(0);
}

/** The row of the Queued email sends panel whose status reads `status`. */
function sendRow(panel: Locator, page: Page, status: string): Locator {
  return panel.locator(':scope > div').filter({
    has: page.getByRole('status').filter({ hasText: status }),
  });
}

/** Delivers a message from grace and returns its thread once Macro has it. */
async function lunch(mailbox: Mailbox) {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Lunch?',
    text: 'Noon at the usual?',
  });
  return mailbox.synced('Lunch?');
}

test.describe('an Undo whose outcome this browser cannot read back, in a Gmail inbox', () => {
  // Undo, and what this browser reads back of it, are the browser's own and
  // the same for either provider: Gmail only.
  test.use({ provider: 'GMAIL' });
  // The service holds a send this long before it delivers it, so Undo is on
  // offer for as long as the test needs.
  test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '45' } });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Undo no longer says it failed when this browser cannot
  // learn what became of the send: the service confirmed the cancellation,
  // the browser put the draft back and dropped the send from its journal,
  // and then the read of the send's status, which Undo needs before it calls
  // the send cancelled, did not get through. Undo then says nothing, or that
  // the send was cancelled on a confirmation it never read.
  //
  // Which of two things the browser does first decides what Undo finds: when
  // it reads the journal while the send is still there, marked cancelled, it
  // needs no status and says "Send cancelled" (about one run in seven on a
  // loaded machine). The draft is then back in the composer, so the test
  // sends it and takes it back again, up to four times.
  test('an Undo the service confirms and this browser cannot read back says it failed', async ({
    page,
    mailbox,
  }) => {
    await composeNew(page, mailbox, {
      to: 'grace@example.com',
      subject: 'Take it back',
      body: 'The numbers are in.',
    });
    // From Undo on, every read of the send's status is lost on the way.
    let undoing = false;
    await failOperation(page, 'EmailSendAttempt', () => undoing);
    const failed = notice(page, 'Failed to undo send');
    const send = page.getByRole('button', { name: 'Send email' });
    for (let attempt = 0; attempt < 4; attempt++) {
      undoing = false;
      const accepted = answered(page, 'SendEmailMessage');
      await send.click();
      await accepted;
      const cancelled = answered(page, 'CancelEmailSend');
      undoing = true;
      await notice(page, 'Sending…')
        .last()
        .getByRole('button', { name: 'Undo' })
        .click();
      await cancelled;
      // Undo says how it ended as soon as "Cancelling send…" goes.
      await expect(notice(page, 'Cancelling send…')).toHaveCount(0);
      const saidFailed = await failed
        .waitFor({ state: 'visible', timeout: 3_000 })
        .then(
          () => true,
          () => false
        );
      if (saidFailed) break;
      // It said the send was cancelled: the draft is back, to send again.
      await expect(send).toBeVisible();
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue(
        'Take it back'
      );
      await expect(page.getByText('grace@example.com').first()).toBeVisible();
    }
    await expect(failed).toBeVisible();
    saw('STC-032');
    // The service did cancel it.
    expect(await openSendAttempts(mailbox)).toBe(0);
  });
});

test.describe('a reply to a reply still on its way, in a Gmail inbox', () => {
  // What waits on this device comes from its own journal, the same code for
  // either provider: Gmail only.
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a reply that waits on this device for the reply it
  // answers (the service would refuse it while that one is still a draft)
  // is hidden from the Queued email sends panel while the device is
  // offline, or is listed without its subject or its Cancel, or as already
  // handed to the service.
  test('a reply waiting for the reply it answers says it is queued on this device', async ({
    page,
    context,
    mailbox,
  }) => {
    const thread = await lunch(mailbox);
    // The first reply never gets an answer from the service.
    const first = await holdOperation(page, 'SendEmailMessage');
    await mailbox.open(`/app/mail/${thread.id}`);
    await sendReply(page, 'Noon works.');
    await first.arrived;
    // The thread shows it sent; the user answers it again at once.
    await expect(
      page
        .locator('main [data-message-body-id]')
        .filter({ hasText: 'Noon works.' })
    ).toBeVisible();
    await sendReply(page, 'Make it half past.');

    await context.setOffline(true);
    const panel = await sendsPanel(page);
    const queued = sendRow(panel, page, 'Queued on this device');
    await expect(queued).toHaveCount(1);
    await expect(queued.getByText('Re: Lunch?')).toBeVisible();
    await expect(panelButton(queued, 'Cancel')).toBeEnabled();
    saw('STC-099', 'F-135');
    // The first reply was handed to the service, which has not answered.
    await expect(sendStatus(panel, 'Checking server acceptance')).toBeVisible();
  });
});
