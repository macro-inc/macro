import type { ResultError } from '@core/util/result';
import { throwOnErr } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import type { WhatsAppGroupApi } from '@queries/whatsapp-groups';
import type { LinkedReplyContent } from '@service-storage/generated/schemas/linkedReplyContent';
import type { LinkedSendProgress } from '@service-storage/generated/schemas/linkedSendProgress';
import type { WhatsAppPersonRef } from '@service-storage/generated/schemas/whatsAppPersonRef';
import type { WhatsAppRichContent } from '@service-storage/generated/schemas/whatsAppRichContent';
import type { WhatsAppErrorCode } from '@service-storage/whatsapp-errors';
import { whatsappGroupsClient as client } from '@service-storage/whatsapp-groups';
import { err, ok } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { phoneFromJid } from '../../whatsapp-linked/core/account';
import type { GroupSend, SendFailure, SendProgress } from '../core/group';
import type { Person, RichContent } from '../core/rich';

function person(ref: WhatsAppPersonRef): Person {
  return { name: ref.name, userId: ref.user_id ?? undefined };
}

/** DSS's rich content in feature terms; nulls become absent. */
function richContent(rich: WhatsAppRichContent): RichContent | undefined {
  return (
    match(rich)
      .returnType<RichContent | undefined>()
      .with({ type: 'poll' }, (poll) => ({
        type: 'poll',
        question: poll.question,
        options: poll.options.map((option) => ({
          name: option.name,
          votes: option.votes,
          mine: option.mine,
          voters: option.voters.map(person),
        })),
        selectableCount: poll.selectable_count,
        voters: poll.voters,
      }))
      .with({ type: 'location' }, (location) => ({
        type: 'location',
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name ?? undefined,
        address: location.address ?? undefined,
        url: location.url ?? undefined,
        live: location.live ?? false,
        comment: location.comment ?? undefined,
      }))
      .with({ type: 'contacts' }, (contacts) => ({
        type: 'contacts',
        contacts: contacts.contacts.map((card) => ({
          name: card.name,
          phones: card.phones,
        })),
      }))
      .with({ type: 'event' }, (event) => ({
        type: 'event',
        name: event.name,
        description: event.description ?? undefined,
        startAt: event.start_at ?? undefined,
        endAt: event.end_at ?? undefined,
        location: event.location ?? undefined,
        joinLink: event.join_link ?? undefined,
        canceled: event.canceled ?? false,
      }))
      .with({ type: 'system' }, (line) => ({
        type: 'system',
        action: line.action,
        actor: line.actor ? person(line.actor) : undefined,
        participants: line.participants.map(person),
        value: line.value ?? undefined,
        call: line.call
          ? {
              video: line.call.video,
              outcome: line.call.outcome,
              durationSeconds: line.call.duration_seconds ?? undefined,
            }
          : undefined,
      }))
      // A newer server's content type renders as the message body alone.
      .exhaustive(() => undefined)
  );
}

function content(request: GroupSend): LinkedReplyContent {
  return match(request)
    .with({ kind: 'text' }, ({ text, mentions }) => ({
      type: 'text' as const,
      text,
      mentions: mentions ?? [],
    }))
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

function sentenceCase(text: string) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}

/**
 * Refusals were never recorded and say why; anything else may have been
 * recorded, so the caller retries with the same idempotency key.
 */
function writeFailure(
  errors: ResultError<WhatsAppErrorCode | BaseFetchErrorCode>[]
): SendFailure {
  const [error] = errors;
  if (!error) return { kind: 'unknown' };
  return (
    match(error.code)
      .returnType<SendFailure>()
      .with(
        P.union(
          'NETWORK_ERROR',
          'SERVER_ERROR',
          'HTTP_ERROR',
          'INVALID_JSON',
          'UNKNOWN_ERROR',
          'temporarily_unavailable',
          'lease_fenced',
          // Not recorded; DSS takes one write per second per person.
          'rate_limited'
        ),
        () => ({ kind: 'unknown' })
      )
      .with('invalid_input', () => ({
        kind: 'refused',
        reason: sentenceCase(error.message),
      }))
      .with(P.union('disconnected', 'UNAUTHORIZED'), () => ({
        kind: 'refused',
        reason: 'Connect your WhatsApp in External to send.',
      }))
      .with(P.union('forbidden', 'FORBIDDEN'), () => ({
        kind: 'refused',
        reason: "Your WhatsApp can't send to this group.",
      }))
      .with(P.union('not_found', 'NOT_FOUND', 'GONE'), () => ({
        kind: 'refused',
        reason: 'That message or upload is no longer available.',
      }))
      .with('configuration_required', () => ({
        kind: 'refused',
        reason: 'Sending to WhatsApp is turned off.',
      }))
      .with('send_expired', () => ({
        kind: 'refused',
        reason: "WhatsApp wasn't reachable in time, so this wasn't sent.",
      }))
      .with(P.union('conflict', 'CONFLICT', 'identity_conflict'), () => ({
        kind: 'refused',
        reason: 'This conflicts with an earlier WhatsApp request.',
      }))
      // A code this build doesn't know may have been recorded: retry quietly.
      .exhaustive(() => ({ kind: 'unknown' }))
  );
}

function progress(send: LinkedSendProgress): SendProgress {
  return {
    id: send.id,
    state: send.state,
    messageId: send.message_id ?? undefined,
    errorCode: send.error_code ?? undefined,
  };
}

/** Decodes DSS's generated wire models at the feature boundary. */
export const whatsappGroupApi: WhatsAppGroupApi = {
  list: async () =>
    (await throwOnErr(client.list)).map((group) => ({
      id: group.id,
      name: group.name,
      unreadCount: group.unread_count,
      canSend: group.can_send,
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
      backfill: view.backfill
        ? { state: view.backfill.state, imported: view.backfill.imported }
        : undefined,
      limits: {
        textBytes: view.limits.text_limit_bytes,
        attachmentBytes: view.limits.attachment_limit_bytes,
        attachmentTypes: view.limits.attachment_types,
        maxAttachments: view.limits.max_attachments,
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
        kind: message.kind,
        sender: {
          name: message.sender.name,
          userId: message.sender.user_id ?? undefined,
        },
        body: message.body,
        mentions: message.mentions.map((mention) => ({
          token: mention.token,
          ...person(mention),
        })),
        forwarded: message.forwarded,
        rich: message.rich ? richContent(message.rich) : undefined,
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
          mime: attachment.mime,
          documentId: attachment.document_id ?? undefined,
          width: attachment.width ?? undefined,
          height: attachment.height ?? undefined,
          durationSeconds: attachment.duration_seconds ?? undefined,
          presentation: attachment.presentation ?? undefined,
        })),
      })),
    };
  },
  send: async (id, request, idempotencyKey) => {
    const result = await client.send(id, {
      idempotency_key: idempotencyKey,
      message: content(request),
      reply_to: 'replyTo' in request ? (request.replyTo ?? null) : null,
    });
    return result.isOk()
      ? ok(progress(result.value))
      : err(writeFailure(result.error));
  },
  delivery: async (id, sendIds) =>
    (await throwOnErr(() => client.delivery(id, sendIds))).map(progress),
  upload: async (id, file) => {
    const result = await client.upload(id, file);
    return result.isOk()
      ? ok({
          uploadId: result.value.upload_id,
          audio: result.value.kind === 'audio',
        })
      : err(writeFailure(result.error));
  },
  markRead: (id, messageId) => throwOnErr(() => client.markRead(id, messageId)),
  stopSync: (id) => throwOnErr(() => client.stopSync(id)),
};
