import { throwOnErr } from '@core/util/result';
import type { WhatsAppGroupApi } from '@queries/whatsapp-groups';
import type { LinkedReplyContent } from '@service-storage/generated/schemas/linkedReplyContent';
import { whatsappGroupsClient as client } from '@service-storage/whatsapp-groups';
import { match } from 'ts-pattern';
import { phoneFromJid } from '../../whatsapp-linked/core/account';
import type { GroupSend } from '../core/group';

function content(request: GroupSend): LinkedReplyContent {
  return match(request)
    .with({ kind: 'text' }, ({ text }) => ({ type: 'text' as const, text }))
    .with({ kind: 'media' }, ({ uploadId, caption }) => ({
      type: 'media' as const,
      upload_id: uploadId,
      caption: caption ?? null,
    }))
    .with({ kind: 'reaction' }, ({ messageId, emoji }) => ({
      type: 'mutation' as const,
      message_id: messageId,
      operation: 'reaction' as const,
      text: emoji,
    }))
    .with({ kind: 'edit' }, ({ messageId, text }) => ({
      type: 'mutation' as const,
      message_id: messageId,
      operation: 'edit' as const,
      text,
    }))
    .with({ kind: 'delete' }, ({ messageId }) => ({
      type: 'mutation' as const,
      message_id: messageId,
      operation: 'delete' as const,
      text: null,
    }))
    .exhaustive((unknown) => {
      // GroupSend is built by this client, so an unknown kind is a bug here.
      throw new Error(`Unsupported WhatsApp send: ${JSON.stringify(unknown)}`);
    });
}

/** Decodes DSS's generated wire models at the feature boundary. */
export const whatsappGroupApi: WhatsAppGroupApi = {
  list: async () =>
    (await throwOnErr(client.list)).map((group) => ({
      id: group.id,
      name: group.name,
      unreadCount: group.unread_count,
    })),
  detail: async (id) => {
    const view = await throwOnErr(() => client.detail(id));
    return {
      id,
      name: view.name,
      ownerId: view.user_id,
      accessLevel: view.access_level,
      canSend: view.can_send,
      sendReason: view.send_reason ?? undefined,
      phone: view.sending_identity
        ? phoneFromJid(view.sending_identity)
        : undefined,
      unreadCount: view.unread_count,
      members: (view.roster?.participants ?? []).map((person) => ({
        id: person.jid,
        name:
          person.displayName ??
          phoneFromJid(person.jid) ??
          'WhatsApp participant',
        admin: person.admin,
      })),
      limits: {
        textBytes: view.limits.text_limit_bytes,
        attachmentBytes: view.limits.attachment_limit_bytes,
        attachmentTypes: view.limits.attachment_types,
        editSeconds: view.limits.mutation_window_seconds,
        mutations: view.limits.mutations,
      },
    };
  },
  messages: async (id, before) => {
    const page = await throwOnErr(() => client.messages(id, before));
    return {
      before: page.next_cursor ?? undefined,
      messages: page.messages.map((message) => ({
        id: message.id,
        sender: {
          name: message.sender.name,
          userId: message.sender.user_id ?? undefined,
        },
        body: message.body,
        sentAt: message.sent_at,
        edited: !!message.edited_at,
        deleted: message.deleted,
        replyTo: message.reply_to ?? undefined,
        reactions: message.reactions.map((reaction) => ({
          emoji: reaction.emoji,
          count: reaction.count,
          mine: reaction.mine,
        })),
        attachments: message.attachments.map((attachment) => ({
          ordinal: attachment.ordinal,
          state: attachment.state,
          fileName: attachment.file_name,
          documentId: attachment.document_id ?? undefined,
        })),
        delivery: message.delivery_state ?? undefined,
      })),
    };
  },
  sends: async (id) =>
    (await throwOnErr(() => client.sends(id)))
      .filter(
        (send) =>
          !send.message_id &&
          !['accepted', 'sent', 'delivered', 'read'].includes(send.state)
      )
      .map((send) => ({
        id: send.id,
        state: send.state,
        errorCode: send.error_code ?? undefined,
        preview: match(send.payload.message)
          .with({ type: 'text' }, (message) => message.text)
          .with({ type: 'media' }, (message) => message.caption ?? 'Attachment')
          .with({ type: 'mutation' }, () => 'Message change')
          .exhaustive(() => 'Message'),
      })),
  send: (id, request, idempotencyKey) =>
    throwOnErr(() =>
      client.send(id, {
        idempotency_key: idempotencyKey,
        message: content(request),
        reply_to: 'replyTo' in request ? (request.replyTo ?? null) : null,
      })
    ),
  upload: async (id, file) => {
    const result = await throwOnErr(() => client.upload(id, file));
    return { uploadId: result.upload_id, audio: result.kind === 'audio' };
  },
  markRead: (id, messageId) => throwOnErr(() => client.markRead(id, messageId)),
  stopSync: (id) => throwOnErr(() => client.stopSync(id)),
};
