// What a send says after Send: Undo while the service has not yet answered
// the cancel, a cancel it never confirms, Undo after delivery began, Undo of
// a send whose delivery could not be confirmed, and the notice of a send
// whose delivery could not be confirmed. Each for a Gmail and an Outlook
// inbox.

import type { Page } from '@playwright/test';
import {
  composeNew,
  graphqlOperation,
  loadAppSteadily,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice, sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
import { hold, leaveSendUnconfirmed, operation } from './harness/states-send1';
import { saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/**
 * Writes and sends a new message, and waits until the service took it: an
 * Undo from then on has to be confirmed by the service.
 */
async function sendAndWaitForService(
  page: Page,
  mailbox: Mailbox,
  subject: string
): Promise<void> {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject,
    body: 'The numbers are in.',
  });
  const accepted = page.waitForResponse(
    (response) =>
      graphqlOperation(response.request()) === 'SendEmailMessage' &&
      response.ok()
  );
  await page.getByRole('button', { name: 'Send email' }).click();
  await accepted;
}

/** Presses Undo on the newest "Sending…" notice. */
async function undo(page: Page): Promise<void> {
  await notice(page, 'Sending…')
    .last()
    .getByRole('button', { name: 'Undo' })
    .click();
}

for (const provider of PROVIDERS) {
  test.describe(`what Undo of a send says, ${provider === 'GMAIL' ? 'Gmail' : 'Outlook'} inbox`, () => {
    test.use({ provider });
    // The service holds a send this long before it delivers it, so Undo is
    // on offer for as long as the test needs.
    test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '45' } });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Undo of a send looks like it did nothing: no notice
    // says the cancel is under way, or, when the service never confirms it,
    // the user is not told the cancel still waits and may believe the
    // message is gone (or sent).
    test('an Undo the service has not confirmed says it is cancelling, then that it waits', async ({
      page,
      mailbox,
    }) => {
      await sendAndWaitForService(page, mailbox, 'Hold that');
      const cancel = await hold(page, operation('CancelEmailSend'));
      await undo(page);
      await cancel.arrived;
      await expect(notice(page, 'Cancelling send…')).toBeVisible();
      saw('STC-400');
      // The browser waits fifteen seconds for the service's answer.
      const pending = notice(page, 'Cancellation pending');
      await expect(pending).toContainText('Waiting for confirmation', {
        timeout: 30_000,
      });
      saw('STC-029');
      await cancel.release();
    });

    // When this fails, Undo of a send whose delivery the service could not
    // confirm says it cancelled it, or says nothing: the user believes the
    // message did not go out, when it may have.
    test('an Undo of a send whose delivery could not be confirmed says so', async ({
      page,
      mailbox,
    }) => {
      await sendAndWaitForService(page, mailbox, 'Maybe out');
      const cancel = await hold(page, operation('CancelEmailSend'));
      await undo(page);
      await cancel.arrived;
      await leaveSendUnconfirmed(mailbox);
      await cancel.release();
      await expect(
        notice(
          page,
          'Delivery unconfirmed; check your sent mail. We will not resend automatically.'
        )
      ).toBeVisible();
      saw('STC-401');
    });

    // When this fails, Undo of a message the service has already delivered
    // says it cancelled it, or nothing at all: the user believes the
    // message was taken back when the recipient has it.
    test('an Undo after delivery began says it is too late', async ({
      page,
      mailbox,
    }) => {
      await sendAndWaitForService(page, mailbox, 'Already gone');
      // The cancel leaves the browser before the delivery and reaches the
      // service after it.
      const cancel = await hold(page, operation('CancelEmailSend'));
      await undo(page);
      await cancel.arrived;
      const due = await mailbox.stack.sql(
        `UPDATE email_scheduled_messages SET send_time = now()
         WHERE link_id = '${mailbox.inbox.linkId}' AND NOT sent
         RETURNING message_id`
      );
      expect(due).toHaveLength(1);
      await mailbox.stack.runScheduledSweep();
      await expect
        .poll(async () => (await sentMessages(mailbox)).length, {
          timeout: 30_000,
        })
        .toBe(1);
      await cancel.release();
      await expect(notice(page, 'Too late to undo')).toContainText(
        'Delivery has already started'
      );
      saw('STC-030');
    });

    // When this fails, a send whose delivery the service could not confirm
    // is left showing "Sending…" with its Undo, or is called sent: the user
    // is not told to look in Sent before writing it again.
    test('a send whose delivery could not be confirmed says so', async ({
      page,
      mailbox,
    }) => {
      await sendAndWaitForService(page, mailbox, 'Unknown fate');
      await leaveSendUnconfirmed(mailbox);
      // The browser asks after the send every few seconds.
      const unconfirmed = page.getByRole('status', {
        name: 'Delivery unconfirmed',
        exact: true,
      });
      await expect(unconfirmed).toContainText(
        'Check your sent mail. We will not resend automatically.',
        { timeout: 30_000 }
      );
      saw('STC-027');
      await expect(notice(page, 'Sending…')).toHaveCount(0);
    });
  });
}
