import { expect, test } from './harness/fixtures';
import {
  gmailSaveDraft,
  htmlBody,
  notice,
  occurrences,
  onlySentRaw,
  paste,
  replyEditor,
  threadMessages,
} from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.describe('what the recipient gets', () => {
  // Class quoted-thread-appended-twice: a reply started in Gmail carries
  // Gmail's copy of the conversation. When this fails the composer takes
  // that copy for the reply's own text and appends the conversation again,
  // so the recipient reads it twice.
  test('a reply drafted in Gmail and sent from Macro quotes the thread once', async ({
    page,
    mailbox,
  }) => {
    const original = await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Venue',
      text: 'Is the hall booked?',
      messageId: 'venue-1@example.com',
    });
    const thread = await mailbox.synced('Venue');
    await gmailSaveDraft(mailbox, {
      threadId: original.threadId,
      raw: [
        'From: ada@example.com',
        'To: Grace <grace@example.com>',
        'Subject: Re: Venue',
        'In-Reply-To: <venue-1@example.com>',
        'References: <venue-1@example.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="utf-8"',
        '',
        '<div dir="ltr">Yes, since Monday.</div><br>' +
          '<div class="gmail_quote"><div dir="ltr" class="gmail_attr">' +
          'On Mon, Nov 9, 2026 at 9:00 AM Grace &lt;grace@example.com&gt; wrote:<br></div>' +
          '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;padding-left:1ex">' +
          'Is the hall booked?</blockquote></div>',
      ].join('\r\n'),
    });
    await expect
      .poll(
        async () =>
          (await threadMessages(mailbox, thread.id)).some(
            (message) => message.is_draft
          ),
        { message: 'Macro never synced the draft', timeout: 60_000 }
      )
      .toBe(true);
    confirmed('F-021');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await expect(replyEditor(page)).toContainText('Yes, since Monday.');
    saw('STL-962');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');
    await expect(notice(page, 'Sending…')).toBeVisible();
    saw('STC-024');

    const html = htmlBody(await onlySentRaw(mailbox));
    expect(occurrences(html, 'Yes, since Monday.')).toBe(1);
    expect(occurrences(html, 'Is the hall booked?')).toBe(1);
    confirmed('F-132');
  });

  // Class send-html-differs-from-composer: the composer shows a blank line
  // between paragraphs. When this fails they arrive run together, one line
  // break apart.
  test('paragraphs arrive a blank line apart', async ({ page, mailbox }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Agenda',
      text: 'What do we cover?',
    });
    const thread = await mailbox.synced('Agenda');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    const editor = replyEditor(page);
    await editor.pressSequentially('First point.');
    did('AC-081');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('Second point.');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('Third point.');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    const html = htmlBody(await onlySentRaw(mailbox));
    // Everything but the line breaks, which are what a mail client lays out.
    const lines = html.replace(/<(?!br\b)[^>]*>/g, '');
    expect(lines).toContain(
      'First point.<br><br>Second point.<br><br>Third point.'
    );
    confirmed('F-102');
    confirmed('F-132');
  });

  // Class send-html-differs-from-composer: when this fails a booking link
  // the composer showed as a chip arrives as text that cannot be clicked.
  test('a booking link arrives as a link to the booking page', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Call?',
      text: 'When are you free?',
    });
    const thread = await mailbox.synced('Call?');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    const editor = replyEditor(page);
    await editor.pressSequentially('Pick a time: ');
    did('AC-081');
    await paste(editor, 'https://macro.com/app/book/ada/intro');
    did('AC-042');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    const html = htmlBody(await onlySentRaw(mailbox));
    expect(html).toMatch(
      /<a\s[^>]*href="https:\/\/macro\.com\/app\/book\/ada\/intro"[^>]*>intro<\/a>/
    );
    confirmed('F-104');
    confirmed('F-132');
  });
});
