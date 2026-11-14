import { expect, test } from './harness/fixtures';
import { injectFault, notice, replyEditor, sentMessages } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.describe('a send the provider refuses', () => {
  // Long enough for the Undo offer to be seen before the server sends.
  test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '4' } });

  // Class send-queued-outcome-not-followed: when this fails the composer
  // says "Email sent" as soon as the send is queued and the user never
  // learns that the provider refused it.
  test('says Sending until the provider answers, then reports the failure', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await mailbox.synced('Lunch?');
    await injectFault(mailbox, { route: 'messages.send', error: 'forbidden' });

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await replyEditor(page).pressSequentially('Works for me.');
    did('AC-081');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    const sending = notice(page, 'Sending…');
    await expect(sending).toBeVisible();
    await expect(sending.getByRole('button', { name: 'Undo' })).toBeVisible();
    saw('STC-024');

    await expect(page.getByText('Email failed to send')).toBeVisible();
    saw('STC-026');
    await expect(page.getByText('Email sent', { exact: true })).toHaveCount(0);
    await expect(sending).toHaveCount(0);
    // The reply is still there to recover, and the thread is back in the inbox.
    await expect(
      page.getByText(
        'Send failed before delivery. Cancel to recover this draft.'
      )
    ).toBeVisible();
    saw('STC-105');
    await expect
      .poll(async () =>
        (await mailbox.providerMessages()).map((message) => message.inInbox)
      )
      .toEqual([true]);
    expect(await sentMessages(mailbox)).toEqual([]);
  });
});

test.describe('a browser that wrongly reads offline', () => {
  // Class send-blocked-or-stalled-on-client: when this fails a send queued
  // while `navigator.onLine` reads false (a desktop webview does that with a
  // working connection, and never fires `online`) is never dispatched.
  test('still sends the reply', async ({ page, mailbox }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await mailbox.synced('Lunch?');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await replyEditor(page).pressSequentially('Works for me.');
    did('AC-081');
    await page.evaluate(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        get: () => false,
      });
    });
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    await expect
      .poll(
        async () =>
          (await sentMessages(mailbox)).map((message) => message.subject),
        {
          timeout: 30_000,
        }
      )
      .toEqual(['Re: Lunch?']);
    confirmed('F-132');
  });
});
