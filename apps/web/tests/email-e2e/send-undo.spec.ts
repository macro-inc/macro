import { expect, test } from './harness/fixtures';
import {
  notice,
  replyEditor,
  sentMessages,
  syncedIn,
  threadMessages,
} from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const UNDO_WINDOW_SECS = 8;

test.describe('undoing a send', () => {
  test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: String(UNDO_WINDOW_SECS) } });

  // Class undo-send-restores-wrong-state: when this fails Undo gives back
  // something other than the reply as written: the quoted thread baked into
  // its text, a second draft, a draft in the signed-in inbox instead of the
  // one that replied, or the message goes out anyway.
  test('gives back the reply as written, in the inbox that wrote it, and sends nothing', async ({
    page,
    mailbox,
  }) => {
    const side = await mailbox.stack.link(
      mailbox.user,
      'GMAIL',
      'ada.side@example.com'
    );
    await mailbox.stack.deliver(side.email, {
      from: 'Grace <grace@example.com>',
      to: side.email,
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    const thread = await syncedIn(mailbox, side, 'Lunch?');

    await mailbox.open(`/app/mail/${thread.id}`);
    did('AL-910');
    await page.getByText('Reply...').click();
    did('AL-171');
    await replyEditor(page).pressSequentially('hello');
    did('AC-081');
    await page.getByRole('button', { name: 'Send email' }).click();
    did('AC-091');
    const sendPressed = Date.now();
    await notice(page, 'Sending…')
      .getByRole('button', { name: 'Undo' })
      .click();
    did('AC-059');
    await expect(notice(page, 'Send cancelled')).toBeVisible();
    saw('STC-028');

    // The composer is back with what was typed, and only that.
    await expect(replyEditor(page)).toHaveText('hello');
    saw('STC-970');
    await expect(
      page.getByRole('button', { name: 'Replying to Grace' })
    ).toBeVisible();
    saw('STC-094', 'F-109');

    // The saved draft is the one draft of the thread, as written, in the second inbox.
    const drafts = async () =>
      (await threadMessages(mailbox, thread.id, side)).filter(
        (message) => message.is_draft
      );
    await expect.poll(async () => (await drafts()).length).toBe(1);
    const [draft] = await drafts();
    expect(draft.link_id).toBe(side.linkId);
    expect(draft.from).toMatchObject({ email: side.email });
    expect(draft.body_html_sanitized).toContain('hello');
    expect(draft.body_html_sanitized).not.toContain('Noon at the usual place?');
    expect(draft.body_html_sanitized).not.toContain('macro_quote');

    // Past the time the send was due, with the queue swept and later mail
    // synced, neither inbox has sent anything.
    await expect
      .poll(() => Date.now() - sendPressed, { timeout: 30_000 })
      .toBeGreaterThan((UNDO_WINDOW_SECS + 2) * 1000);
    await mailbox.stack.runScheduledSweep();
    await mailbox.stack.deliver(side.email, {
      from: 'Grace <grace@example.com>',
      to: side.email,
      subject: 'Later',
      text: 'Still there?',
    });
    await syncedIn(mailbox, side, 'Later');
    expect(await sentMessages(mailbox, side)).toEqual([]);
    expect(await sentMessages(mailbox)).toEqual([]);
    confirmed('F-134');
    expect((await drafts()).length).toBe(1);
  });
});
