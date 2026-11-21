// What the list's other ways in need beyond `harness/ways-list1.ts` and
// `harness/ways-list2.ts`: a thread in Focus with the flag Focus filters on.

import { expect } from '@playwright/test';
import type { Mailbox } from './fixtures';

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
 * Follow up shows only when the owner wrote last, Reply needed only when
 * someone else did.
 */
export async function inFocus(
  mailbox: Mailbox,
  threadId: string,
  flag: FocusFlag
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `INSERT INTO email_thread_focus (
       thread_id, link_id, classified_message_id, classified_message_ts,
       is_focus, category, importance, needs_reply, needs_follow_up, scores,
       model, classified_at)
     SELECT t.id, t.link_id, m.id, COALESCE(m.internal_date_ts, m.created_at),
            true, 'known', 50, ${flag === 'reply'}, ${flag === 'follow-up'},
            '{}'::jsonb, 'email-e2e', now()
     FROM email_threads t
     JOIN LATERAL (
       SELECT id, internal_date_ts, created_at FROM email_messages
       WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
     ) m ON true
     WHERE t.id = '${threadId}' AND t.link_id = '${mailbox.inbox.linkId}'
     RETURNING thread_id`
  );
  expect(rows).toHaveLength(1);
}
