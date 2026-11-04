import type { MessageData } from '@core/messages/types';
import type { ChatProvider } from '../providers';
import type { ChatMessage } from './chat';

/**
 * A chat message in the shape the shared channel rows render. Macro users
 * show as themselves (Macro name and avatar); everyone else by their
 * provider name.
 */
export function chatMessageData(
  message: ChatMessage,
  viewerId: string | undefined,
  /** The provider's received-text converter; the body is untrusted. */
  toMarkdown: ChatProvider['formatting']['toMarkdown']
): MessageData {
  return {
    id: message.id,
    content: message.deleted ? '' : toMarkdown(message.body, message.mentions),
    sender_id: message.sender.userId ?? '',
    imported_author:
      !message.sender.userId && message.sender.name.trim()
        ? { name: message.sender.name }
        : null,
    created_at: message.sentAt,
    updated_at: message.sentAt,
    edited_at: message.edited ? message.sentAt : null,
    deleted_at: message.deleted ? message.sentAt : null,
    // Attachments are static files the view renders itself: media inline,
    // other files as chips that open them.
    attachments: [],
    // Providers report counts, not reactors; others stay unnamed.
    reactions: message.reactions.map((reaction) => {
      const mine = reaction.mine && viewerId ? [viewerId] : [];
      return {
        emoji: reaction.emoji,
        users: [
          ...mine,
          ...Array.from(
            { length: Math.max(0, reaction.count - mine.length) },
            (_, index) => `external-reactor:${index}`
          ),
        ],
      };
    }),
  };
}

/** Consecutive messages from one person group like a channel's. */
export function senderKey(message: ChatMessage): string {
  return message.sender.userId ?? `external:${message.sender.name}`;
}
