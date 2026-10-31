import type { ResultError } from '@core/util/result';
import { throwOnErr } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import type { ExternalChatApi } from '@queries/external-chats';
import { externalChatsClient as client } from '@service-storage/external-chats';
import type { ExternalChatPersonRef } from '@service-storage/generated/schemas/externalChatPersonRef';
import type { ExternalChatReplyContent } from '@service-storage/generated/schemas/externalChatReplyContent';
import type { ExternalChatRichContent } from '@service-storage/generated/schemas/externalChatRichContent';
import type { ExternalChatSendProgress } from '@service-storage/generated/schemas/externalChatSendProgress';
import type { WhatsAppErrorCode } from '@service-storage/whatsapp-errors';
import { err, ok } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { phoneFromJid } from '../../whatsapp-linked/core/account';
import type { ChatSend, SendFailure, SendProgress } from '../core/chat';
import { type Person, type RichContent, webLink } from '../core/rich';

function person(ref: ExternalChatPersonRef): Person {
  return { name: ref.name, userId: ref.userId ?? undefined };
}

/** DSS's rich content in feature terms; nulls become absent. */
function richContent(rich: ExternalChatRichContent): RichContent | undefined {
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
        selectableCount: poll.selectableCount,
        voters: poll.voters,
      }))
      .with({ type: 'location' }, (location) => ({
        type: 'location',
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name ?? undefined,
        address: location.address ?? undefined,
        url: webLink(location.url),
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
        startAt: event.startAt ?? undefined,
        endAt: event.endAt ?? undefined,
        location: event.location ?? undefined,
        joinLink: webLink(event.joinLink),
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
              durationSeconds: line.call.durationSeconds ?? undefined,
            }
          : undefined,
      }))
      // A newer server's content type renders as the message body alone.
      .exhaustive(() => undefined)
  );
}

function content(request: ChatSend): ExternalChatReplyContent {
  return match(request)
    .with({ kind: 'text' }, ({ text, mentions }) => ({
      type: 'text' as const,
      text,
      mentions: mentions ?? [],
    }))
    .with({ kind: 'media' }, ({ uploadId, caption }) => ({
      type: 'media' as const,
      uploadId,
      caption: caption ?? null,
    }))
    .with({ kind: 'reaction' }, ({ messageId, emoji }) => ({
      type: 'mutation' as const,
      messageId,
      operation: 'reaction' as const,
      text: emoji,
    }))
    .with({ kind: 'edit' }, ({ messageId, text }) => ({
      type: 'mutation' as const,
      messageId,
      operation: 'edit' as const,
      text,
    }))
    .with({ kind: 'delete' }, ({ messageId }) => ({
      type: 'mutation' as const,
      messageId,
      operation: 'delete' as const,
      text: null,
    }))
    .exhaustive((unknown) => {
      // ChatSend is built by this client, so an unknown kind is a bug here.
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
          'backlogged',
          'internal_error',
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
        reason: "Your WhatsApp can't send to this chat.",
      }))
      .with(P.union('not_found', 'NOT_FOUND', 'GONE'), () => ({
        kind: 'refused',
        reason: 'That message or upload is no longer available.',
      }))
      .with('send_expired', () => ({
        kind: 'refused',
        reason: "WhatsApp wasn't reachable in time, so this wasn't sent.",
      }))
      .with(
        P.union(
          'cannot_add_not_in_group',
          'cannot_add_community',
          'cannot_add_own_chat',
          'cannot_add_not_in_chat_list'
        ),
        () => ({
          kind: 'refused',
          reason: "This chat can't be in Macro, so nothing was sent.",
        })
      )
      .with(P.union('conflict', 'CONFLICT'), () => ({
        kind: 'refused',
        reason: 'This conflicts with an earlier WhatsApp request.',
      }))
      // A code this build doesn't know may have been recorded: retry quietly.
      .exhaustive(() => ({ kind: 'unknown' }))
  );
}

function progress(send: ExternalChatSendProgress): SendProgress {
  return {
    id: send.id,
    state: send.state,
    messageId: send.messageId ?? undefined,
    errorCode: send.errorCode ?? undefined,
  };
}

/** Decodes DSS's generated wire models at the feature boundary. */
export const externalChatApi: ExternalChatApi = {
  list: async () =>
    (await throwOnErr(client.list)).map((group) => ({
      id: group.id,
      provider: group.provider,
      kind: group.kind,
      name: group.name,
      ownerId: group.userId,
      unreadCount: group.unreadCount,
      canSend: group.canSend,
      sendReason: group.sendReason ?? undefined,
      backfill: group.backfill
        ? { state: group.backfill.state, imported: group.backfill.imported }
        : undefined,
      community: group.community
        ? {
            id: group.community.id,
            name: group.community.name,
            announcements: group.community.announcements,
          }
        : undefined,
    })),
  detail: async (id) => {
    const view = await throwOnErr(() => client.detail(id));
    return {
      id,
      provider: view.provider,
      kind: view.kind,
      name: view.name,
      ownerId: view.userId,
      accessLevel: view.accessLevel,
      canSend: view.canSend,
      sendReason: view.sendReason ?? undefined,
      phone: view.sendingIdentity
        ? phoneFromJid(view.sendingIdentity)
        : undefined,
      unreadCount: view.unreadCount,
      members: (view.members?.participants ?? []).map((person) => ({
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
      disappearingSeconds: view.disappearingSeconds ?? undefined,
      community: view.community
        ? {
            name: view.community.name,
            announcements: view.community.announcements,
          }
        : undefined,
      limits: {
        textBytes: view.limits.textLimitBytes,
        attachmentBytes: view.limits.attachmentLimitBytes,
        attachmentTypes: view.limits.attachmentTypes,
        editSeconds: view.limits.mutationWindowSeconds,
        mutations: view.limits.mutations,
      },
    };
  },
  messages: async (id, before) => {
    const page = await throwOnErr(() => client.messages(id, before));
    return {
      before: page.nextCursor ?? undefined,
      messages: page.messages.map((message) => ({
        id: message.id,
        kind: message.kind,
        sender: {
          name: message.sender.name,
          userId: message.sender.userId ?? undefined,
        },
        body: message.body,
        mentions: message.mentions.map((mention) => ({
          token: mention.token,
          ...person(mention),
        })),
        forwarded: message.forwarded,
        rich: message.rich ? richContent(message.rich) : undefined,
        sentAt: message.sentAt,
        edited: !!message.editedAt,
        deleted: message.deleted,
        replyTo: message.replyTo ?? undefined,
        reactions: message.reactions.map((reaction) => ({
          emoji: reaction.emoji,
          count: reaction.count,
          mine: reaction.mine,
        })),
        attachments: message.attachments.map((attachment) => ({
          ordinal: attachment.ordinal,
          state: attachment.state,
          fileName: attachment.fileName,
          mime: attachment.mime,
          fileId: attachment.fileId ?? undefined,
          width: attachment.width ?? undefined,
          height: attachment.height ?? undefined,
          durationSeconds: attachment.durationSeconds ?? undefined,
          presentation: attachment.presentation ?? undefined,
        })),
      })),
    };
  },
  send: async (id, request, idempotencyKey) => {
    const result = await client.send(id, {
      idempotencyKey,
      message: content(request),
      replyTo: 'replyTo' in request ? (request.replyTo ?? null) : null,
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
          uploadId: result.value.uploadId,
          audio: result.value.kind === 'audio',
        })
      : err(writeFailure(result.error));
  },
  markRead: (id, messageId) => throwOnErr(() => client.markRead(id, messageId)),
  stopSync: (id) => throwOnErr(() => client.stopSync(id)),
};
