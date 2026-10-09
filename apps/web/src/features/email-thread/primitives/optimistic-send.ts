import { createMemo, createSignal } from 'solid-js';
import type {
  EmailComposeContext,
  SendEmailDraft,
} from '../../email-compose/context/compose-capabilities';
import { decodeBase64Utf8 } from '../../email-compose/core/decode-base64';
import type { EmailMessage } from '../../email-message/core/email-message';
import type { EmailThreadSource } from '../context/email-thread-context';

type PendingMessage = {
  token: symbol;
  originalId: string;
  message: EmailMessage;
};

/** Keep REST sends visible in this surface until the thread read catches up. */
export function createOptimisticThreadSend(
  source: EmailThreadSource,
  compose: Pick<EmailComposeContext, 'delivery' | 'accounts' | 'viewerEmail'>
) {
  const [pending, setPending] = createSignal<PendingMessage[]>([]);
  // Remember server acknowledgement so a later deletion or undo cannot
  // resurrect a message from an older optimistic snapshot.
  const confirmed = createMemo<Set<symbol>>((previous) => {
    const messages = source.thread()?.messages ?? [];
    return new Set(
      pending()
        .filter(
          (entry) =>
            previous?.has(entry.token) ||
            messages.some(
              (message) =>
                !message.is_draft && message.db_id === entry.message.db_id
            )
        )
        .map((entry) => entry.token)
    );
  });
  const remove = (token: symbol) =>
    setPending((entries) => entries.filter((entry) => entry.token !== token));

  function prepare(input: SendEmailDraft): PendingMessage | undefined {
    const current = source.thread();
    const draft = input.message;
    if (
      !current ||
      !draft.db_id ||
      (draft.thread_db_id && draft.thread_db_id !== current.db_id)
    )
      return;
    const existing = current.messages.find(
      (message) => message.db_id === draft.db_id
    );
    // Standalone composers send only the draft ID; replies also carry a thread ID.
    if (!existing && !draft.thread_db_id) return;
    const inbox = compose.accounts
      .inboxes()
      .find((inbox) => inbox.id === (input.inboxId ?? current.link_id));
    const now = new Date().toISOString();
    return {
      token: Symbol('send'),
      originalId: draft.db_id,
      message: {
        ...existing,
        db_id: draft.db_id,
        thread_db_id: current.db_id,
        link_id: inbox?.id ?? current.link_id,
        from: inbox
          ? {
              email: inbox.email_address,
              name: inbox.displayName,
              photo_url: inbox.photo_url,
            }
          : (existing?.from ?? { email: compose.viewerEmail() ?? '' }),
        to: draft.to ?? [],
        cc: draft.cc ?? [],
        bcc: draft.bcc ?? [],
        subject: draft.subject,
        body_text: draft.body_text,
        body_macro: draft.body_macro,
        body_html_sanitized: draft.body_html
          ? decodeBase64Utf8(draft.body_html)
          : null,
        body_replyless: null,
        replying_to_id: draft.replying_to_id,
        is_draft: false,
        scheduled_send_time: null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        internal_date_ts: now,
        sent_at: now,
        attachments: existing?.attachments ?? [],
        attachments_draft: existing?.attachments_draft ?? [],
        attachments_forwarded: existing?.attachments_forwarded ?? [],
        labels:
          existing?.labels.filter(
            (label) => label.provider_label_id !== 'DRAFT'
          ) ?? [],
      },
    };
  }

  const thread = () => {
    const current = source.thread();
    if (!current) return;
    const messages = pending().filter(
      (entry) =>
        !confirmed().has(entry.token) &&
        entry.message.thread_db_id === current.db_id
    );
    if (!messages.length) return current;
    const ids = new Set(
      messages.flatMap((entry) => [entry.originalId, entry.message.db_id])
    );
    return {
      ...current,
      messages: [
        ...current.messages.filter((message) => !ids.has(message.db_id)),
        ...messages.map((entry) => entry.message),
      ],
    };
  };

  const delivery: EmailComposeContext['delivery'] = {
    ...compose.delivery,
    async sendMessage(input) {
      const entry = prepare(input);
      if (!entry) return await compose.delivery.sendMessage(input);
      const acknowledged = confirmed();
      setPending((entries) => [
        ...entries.filter((entry) => !acknowledged.has(entry.token)),
        entry,
      ]);
      try {
        const result = await compose.delivery.sendMessage(input);
        setPending((entries) =>
          entries.map((pending) =>
            pending.token === entry.token
              ? {
                  ...pending,
                  message: {
                    ...pending.message,
                    db_id: result.draftId ?? pending.message.db_id,
                    thread_db_id:
                      result.threadId ?? pending.message.thread_db_id,
                    link_id: result.inboxId,
                  },
                }
              : pending
          )
        );
        return result;
      } catch (error) {
        remove(entry.token);
        throw error;
      }
    },
    async undoSend(input) {
      await compose.delivery.undoSend({
        ...input,
        onUndone: async () => {
          setPending((entries) =>
            entries.filter(
              (entry) =>
                entry.originalId !== input.draftId &&
                entry.message.db_id !== input.draftId
            )
          );
          await input.onUndone();
        },
      });
    },
  };
  return { source: { ...source, thread }, delivery };
}
