import { expect, test } from './harness/fixtures';
import { injectFault, notice, replyEditor, sentMessages } from './harness/send';
import type { Provider } from './harness/stack';
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

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a send that fails from ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider, stackEnv: { SENT_UNDO_DELAY_SECS: '4' } });

    // When this fails, a reply the provider refused cannot be taken back
    // out of its status row: Cancel leaves the row, loses the text, or the
    // recovered reply goes out twice or not at all. On Outlook the second
    // send is sometimes answered with a draft conflict (about one run in
    // three) and the reply never goes out.
    test(`${provider === 'OUTLOOK' ? 'known bug: outlook-resend-after-recovered-send-conflicts: ' : ''}a refused reply is cancelled back into its composer and goes out once when sent again`, {
      tag: provider === 'OUTLOOK' ? '@known-bug' : [],
    }, async ({ page, mailbox }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      const thread = await mailbox.synced('Lunch?');
      await injectFault(mailbox, {
        route: 'messages.send',
        error: 'forbidden',
        times: 1,
      });

      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      await page.getByText('Reply...').click();
      did('AL-171');
      await replyEditor(page).pressSequentially('Works for me.');
      did('AC-081');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');

      const sends = page.getByLabel('Queued email sends');
      const failed = sends.getByText(
        'Send failed before delivery. Cancel to recover this draft.'
      );
      await expect(failed).toBeVisible();
      saw('STC-105');
      await sends.getByRole('button', { name: 'Cancel', exact: true }).click();
      did('AC-104', 'F-136');
      await expect(failed).toHaveCount(0);
      await expect(replyEditor(page)).toHaveText('Works for me.');
      saw('STC-914');
      expect(await sentMessages(mailbox)).toEqual([]);

      // The recovered reply is a draft like any other: sent again, it goes
      // out, once.
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(page.getByText('Email sent', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(async () =>
          (await sentMessages(mailbox)).map((message) => message.subject)
        )
        .toEqual(['Re: Lunch?']);
      confirmed('F-136');
    });

    // When this fails, a reply the service rejected is reported as sent, or
    // its status row does not let the user read what they wrote.
    test('a reply the service rejects is reported as failed, and its status row shows what was written', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      const thread = await mailbox.synced('Lunch?');
      // The service answers the send as invalid, once.
      let rejected = false;
      await page.route(/\/graphql$/, async (route) => {
        const sent = route.request().postData() ?? '';
        if (rejected || !sent.includes('"operationName":"SendEmailMessage"')) {
          return route.fallback();
        }
        rejected = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: null,
            errors: [
              {
                message: 'invalid',
                path: ['sendEmailMessage'],
                extensions: { code: 'INVALID' },
              },
            ],
          }),
        });
      });

      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      await page.getByText('Reply...').click();
      did('AL-171');
      await replyEditor(page).pressSequentially('Works for me.');
      did('AC-081');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');

      await expect(page.getByText('Email failed to send')).toBeVisible();
      saw('STC-026');
      await expect(page.getByText('Email sent', { exact: true })).toHaveCount(
        0
      );
      const sends = page.getByLabel('Queued email sends');
      await expect(
        sends.getByText('Send needs attention. Cancel to recover this draft.')
      ).toBeVisible();
      saw('STC-104');
      const saved = sends.getByRole('group').filter({
        hasText: 'View saved message',
      });
      await expect(saved.getByText('Works for me.')).toBeHidden();
      await saved.getByText('View saved message').click();
      did('AC-107');
      await expect(saved.getByText('grace@example.com')).toBeVisible();
      await expect(saved.getByText('Works for me.')).toBeVisible();
      saw('STC-426');
      expect(await sentMessages(mailbox)).toEqual([]);
    });
  });
}
