import { expect, test } from './harness/fixtures';

test.describe('replying from the thread', () => {
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

  // Class reply-subject-prefix: a subject that already carries a reply
  // prefix, in any case and without a space, keeps it and gets no second
  // one. A stacked `Re: RE: x` splits the thread in other mail clients.
  for (const subject of ['RE: Budget', 're:budget']) {
    test(`a reply to "${subject}" keeps that subject`, async ({ page, mailbox }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject,
        text: 'Numbers attached.',
      });
      const thread = await mailbox.synced(subject);

      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('Reply...').click();
      await page.keyboard.type('Thanks.');
      await page.keyboard.press('ControlOrMeta+Enter');

      await expect
        .poll(async () =>
          (await mailbox.providerMessages())
            .filter((message) => message.labels.includes('SENT'))
            .map((message) => message.subject)
        )
        .toEqual([subject]);
    });
  }
});
