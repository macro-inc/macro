import { expect, test } from './harness/fixtures';

test.describe('replying from the thread', () => {
  // Class reply-subject-prefix: a reply's subject is the thread's with one
  // `Re:`; a wrong one splits the thread in the recipient's mailbox.
  test('a reply goes out once, in the thread, with one Re: prefix', async ({
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
    await page.getByText('Reply...').click();
    await page.keyboard.type('Works for me.');
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect
      .poll(async () =>
        (await mailbox.providerMessages())
          .filter((message) => message.labels.includes('SENT'))
          .map((message) => message.subject)
      )
      .toEqual(['Re: Lunch?']);
    const [received, sent] = await mailbox.providerMessages();
    expect(sent.threadId).toBe(received.threadId);
  });
});
