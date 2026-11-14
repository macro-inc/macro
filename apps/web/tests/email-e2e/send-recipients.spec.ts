import { expect, test } from './harness/fixtures';
import { header } from './harness/provider';
import {
  onlySentRaw,
  replyEditor,
  sentMessages,
  syncedIn,
} from './harness/send';
import { confirmed, did, saw } from './ledger/record';

test.describe('replying to all from a second inbox', () => {
  // Class reply-recipients-wrong: "myself" is the inbox that got the mail,
  // not the address the user signed in with. When this fails the reply
  // drops the user's other address from Cc and writes to the replying
  // inbox itself.
  test('keeps the other own address and leaves out the replying inbox', async ({
    page,
    mailbox,
  }) => {
    const side = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'ada.side@example.com'
    );
    await mailbox.stack.deliver(side.email, {
      from: 'Xavier <xavier@example.com>',
      to: side.email,
      cc: `${mailbox.inbox.email}, Yara <yara@example.com>`,
      subject: 'Offsite',
      text: 'Which dates work?',
    });
    const thread = await syncedIn(mailbox, side, 'Offsite');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await expect(
      page.getByRole('button', { name: 'Replying to Xavier + 2' })
    ).toBeVisible();
    saw('STC-094', 'F-109');
    await replyEditor(page).pressSequentially('Any week in May.');
    did('AC-081');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');

    const raw = await onlySentRaw(mailbox, side);
    const addresses = (name: string) =>
      (header(raw, name) ?? '').match(/[\w.+-]+@[\w.-]+/g)?.sort() ?? [];
    expect(addresses('From')).toEqual([side.email]);
    expect(addresses('To')).toEqual(['xavier@example.com']);
    expect(addresses('Cc')).toEqual([mailbox.inbox.email, 'yara@example.com']);
    confirmed('F-109');
    confirmed('F-132');
    // It left from the inbox that was written to, not the signed-in one.
    expect(await sentMessages(mailbox)).toEqual([]);
  });
});
