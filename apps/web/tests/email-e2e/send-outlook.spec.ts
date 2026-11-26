import { expect, test } from './harness/fixtures';
import { injectFault, notice, replyEditor, sentMessages } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.describe('a send from an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });

  // Class send-outlook-not-in-sent-until-sync: Outlook's own copy of a sent
  // message reaches Macro with the next folder sync. When this fails the
  // thread is missing from Sent until then, or the app warns about a send
  // that went through.
  test('is listed in Sent before the mailbox syncs, without a delivery warning', async ({
    page,
    mailbox,
  }) => {
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
    // From here on Outlook's folders cannot be read: no sync brings the sent copy.
    await injectFault(mailbox, {
      route: 'messages.delta',
      error: 'unavailable',
    });
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');
    await expect(notice(page, 'Email sent')).toBeVisible();
    saw('STC-025');
    expect(
      (await sentMessages(mailbox)).map((message) => message.subject)
    ).toEqual(['Re: Lunch?']);
    confirmed('F-132');

    // The thread shows the delivery status panel when it has something to say.
    await expect(page.getByText('Delivery unconfirmed')).toHaveCount(0);
    await expect(page.getByLabel('Queued email sends')).toHaveCount(0);

    // The delivery status poll failing, with nothing pending, is no alarm
    // either: the panel stays away. A second poll starts only once the first has been handled.
    let failedPolls = 0;
    await page.route(/\/graphql$/, async (route) => {
      const body = route.request().postData() ?? '';
      if (!body.includes('"operationName":"PendingEmailSends"'))
        return route.fallback();
      failedPolls += 1;
      await route.fulfill({
        json: {
          data: null,
          errors: [
            { message: 'internal error', extensions: { code: 'INTERNAL' } },
          ],
        },
      });
    });
    await expect
      .poll(async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        return failedPolls;
      })
      .toBeGreaterThan(1);
    await expect(page.getByLabel('Queued email sends')).toHaveCount(0);
    await expect(
      page.getByText('Could not refresh server delivery status')
    ).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Email tabs' })
      .getByRole('button', { name: 'Sent' })
      .click();
    did('AL-002', 'F-030');
    await expect(
      page.getByRole('main').getByText('Works for me.')
    ).toBeVisible();
    saw('STL-923');
  });
});
