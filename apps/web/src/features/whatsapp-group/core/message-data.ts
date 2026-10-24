import type { MessageData } from '@core/messages/types';
import { inlineMediaKind } from './attachments';
import { whatsappToMarkdown } from './formatting';
import type { GroupMessage } from './group';

/**
 * A group message in the shape the shared channel rows render. Senders show
 * their WhatsApp name; Macro users keep their Macro avatar.
 */
export function groupMessageData(
  message: GroupMessage,
  viewerId: string | undefined
): MessageData {
  return {
    id: message.id,
    content: message.deleted ? '' : whatsappToMarkdown(message.body),
    sender_id: message.sender.userId ?? '',
    // WhatsApp's name for everyone, Macro users included: a Macro profile
    // without a name would otherwise show its email.
    imported_author: message.sender.name.trim()
      ? { name: message.sender.name }
      : null,
    created_at: message.sentAt,
    updated_at: message.sentAt,
    edited_at: message.edited ? message.sentAt : null,
    deleted_at: message.deleted ? message.sentAt : null,
    // Images, video and audio play inline (the view renders them); other
    // files show as document chips.
    attachments: message.attachments.flatMap((attachment) =>
      attachment.state === 'ready' &&
      attachment.documentId &&
      !inlineMediaKind(attachment)
        ? [
            {
              id: `${message.id}:${attachment.ordinal}`,
              entity_id: attachment.documentId,
              entity_type: 'document',
              created_at: message.sentAt,
            },
          ]
        : []
    ),
    // WhatsApp reports counts, not reactors; others stay unnamed.
    reactions: message.reactions.map((reaction) => {
      const mine = reaction.mine && viewerId ? [viewerId] : [];
      return {
        emoji: reaction.emoji,
        users: [
          ...mine,
          ...Array.from(
            { length: Math.max(0, reaction.count - mine.length) },
            (_, index) => `whatsapp-reactor:${index}`
          ),
        ],
      };
    }),
  };
}

/** Consecutive messages from one person group like a channel's. */
export function senderKey(message: GroupMessage): string {
  return message.sender.userId ?? `whatsapp:${message.sender.name}`;
}
