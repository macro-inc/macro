import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, createMemo, on } from 'solid-js';
import type {
  EmailComposeContext,
  OutgoingEmail,
} from '../../email-compose/context/compose-capabilities';
import type { EmailMessage } from '../../email-message/core/email-message';
import type { EmailThreadSource } from '../context/email-thread-context';
import type { EmailThread } from '../core/email-thread';

type PendingSend = { send: OutgoingEmail; shownAt: string };

/** Show approved sends as sent in this surface until the thread read catches up. */
export function createOptimisticThreadSend(
  source: EmailThreadSource,
  compose: Pick<EmailComposeContext, 'delivery' | 'accounts' | 'viewerEmail'>
): EmailThreadSource {
  const outgoing = createMemo(() => compose.delivery.outgoing?.() ?? []);
  const tracked = createMemo(
    (previous: { pending: PendingSend[]; confirmed: Set<string> }) => {
      const messages = source.thread()?.messages ?? [];
      const live = outgoing();
      const confirmed = new Set(previous.confirmed);
      const pending: PendingSend[] = [];
      for (const send of [
        ...live,
        // A delivered send leaves the outbox before this read may show it.
        ...previous.pending
          .map((entry) => entry.send)
          .filter(
            (send) =>
              send.delivered &&
              !live.some((row) => row.sendAttemptId === send.sendAttemptId)
          ),
      ]) {
        if (confirmed.has(send.sendAttemptId)) continue;
        if (
          messages.some(
            (message) =>
              !message.is_draft && send.messageIds.includes(message.db_id)
          )
        ) {
          // Once the read shows it, a later deletion must not resurrect it.
          confirmed.add(send.sendAttemptId);
          continue;
        }
        pending.push({
          send,
          shownAt:
            previous.pending.find(
              (entry) => entry.send.sendAttemptId === send.sendAttemptId
            )?.shownAt ?? new Date().toISOString(),
        });
      }
      return { pending, confirmed };
    },
    { pending: [], confirmed: new Set<string>() }
  );

  // The server's copy changes on delivery, and again when a cancelled or
  // failed send returns to a draft; read the thread at either moment.
  createEffect(
    on(outgoing, (current, previous: OutgoingEmail[] = []) => {
      const id = source.id();
      const find = (list: OutgoingEmail[], send: OutgoingEmail) =>
        list.find((row) => row.sendAttemptId === send.sendAttemptId);
      const delivered = current.some(
        (send) =>
          send.delivered &&
          send.threadIds.includes(id) &&
          !find(previous, send)?.delivered
      );
      const returned = previous.some(
        (send) =>
          !send.delivered && send.threadIds.includes(id) && !find(current, send)
      );
      if (delivered || returned)
        fireAndForget(source.refresh(), 'email-thread-send');
    })
  );

  function sentMessage(current: EmailThread, entry: PendingSend): EmailMessage {
    const { send, shownAt } = entry;
    const existing = current.messages.find((message) =>
      send.messageIds.includes(message.db_id)
    );
    const inbox = compose.accounts
      .inboxes()
      .find((inbox) => inbox.id === send.inboxId);
    return {
      ...existing,
      ...send.message,
      db_id: existing?.db_id ?? send.messageIds[0],
      thread_db_id: current.db_id,
      link_id: inbox?.id ?? current.link_id,
      from: inbox
        ? {
            email: inbox.email_address,
            name: inbox.displayName,
            photo_url: inbox.photo_url,
          }
        : (existing?.from ?? { email: compose.viewerEmail() ?? '' }),
      body_replyless: null,
      is_draft: false,
      is_read: existing?.is_read ?? true,
      scheduled_send_time: null,
      scheduled_send_status: null,
      created_at: existing?.created_at ?? shownAt,
      updated_at: shownAt,
      internal_date_ts: shownAt,
      sent_at: shownAt,
      attachments: existing?.attachments ?? [],
      attachments_draft: existing?.attachments_draft ?? [],
      attachments_forwarded: existing?.attachments_forwarded ?? [],
      labels:
        existing?.labels.filter(
          (label) => label.provider_label_id !== 'DRAFT'
        ) ?? [],
    };
  }

  const thread = () => {
    const current = source.thread();
    if (!current) return;
    const sends = tracked().pending.filter(
      ({ send }) =>
        send.threadIds.includes(current.db_id) ||
        current.messages.some((message) =>
          send.messageIds.includes(message.db_id)
        )
    );
    if (!sends.length) return current;
    const ids = new Set(sends.flatMap(({ send }) => send.messageIds));
    return {
      ...current,
      messages: [
        ...current.messages.filter((message) => !ids.has(message.db_id)),
        ...sends.map((entry) => sentMessage(current, entry)),
      ],
    };
  };

  return { ...source, thread };
}
