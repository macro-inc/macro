// What the list's other ways in need beyond `harness/ways-list1.ts` and
// `harness/ways-list2.ts`: a thread in Focus with the flag Focus filters on.

import { expect } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { isoDay, localDay, seedFocus } from './states-list';

/**
 * The owner's reply to a message, sent from Gmail's own client: in the
 * thread, labelled SENT, and announced to Macro. Gmail only.
 */
export async function replyAtGmail(
  mailbox: Mailbox,
  mail: { inReplyTo: string; to: string; subject: string; text: string }
): Promise<void> {
  const base = `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}`;
  const sent = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: mailbox.inbox.email,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      in_reply_to: mail.inReplyTo,
      labels: ['SENT'],
    }),
  });
  expect(sent.ok).toBe(true);
  const pushed = await fetch(`${base}/push`, { method: 'POST' });
  expect(pushed.ok).toBe(true);
}

/** The flag a Focus thread carries: Reply needed, Follow up, or neither. */
export type FocusFlag = 'reply' | 'follow-up' | 'none';

/**
 * Has the thread in Focus with this flag, as the worker that reads mail for
 * Focus would leave it: no stack runs its model. `full-stack-home.spec.ts`
 * seeds Focus the same way. The list settles the flag again on the latest
 * message (`focus_for_threads` in `crates/email/src/outbound/focus_pg.rs`):
 * Reply needed shows only when someone else wrote last, and Follow up only
 * when the owner did and their message has waited three days for an answer
 * or its due day has come. A follow-up thread here is due today.
 */
export async function inFocus(
  mailbox: Mailbox,
  threadId: string,
  flag: FocusFlag
): Promise<void> {
  await seedFocus(mailbox, threadId, {
    category: 'known',
    ...(flag === 'none' ? {} : { flag }),
    ...(flag === 'follow-up' ? { dueOn: isoDay(localDay(0)) } : {}),
  });
}
