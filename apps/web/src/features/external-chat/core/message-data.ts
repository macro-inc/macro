import type { MessageData } from '@core/messages/types';
import type { ChatProvider } from '../providers';
import type { ChatMessage } from './chat';

/**
 * A chat message in the shape the shared channel rows render. Macro users
 * show as themselves (Macro name and avatar); everyone else by their
 * provider name and picture.
 */
export function chatMessageData(
  message: ChatMessage,
  /** The provider's received-text converter; the body is untrusted. */
  toMarkdown: ChatProvider['formatting']['toMarkdown']
): MessageData {
  return {
    id: message.id,
    content: message.deleted ? '' : toMarkdown(message.body, message.mentions),
    sender_id: message.sender.userId ?? '',
    imported_author:
      !message.sender.userId && message.sender.name.trim()
        ? {
            name: message.sender.name,
            avatar_url: message.sender.pictureUrl ?? null,
          }
        : null,
    created_at: message.sentAt,
    updated_at: message.sentAt,
    edited_at: message.edited ? message.sentAt : null,
    deleted_at: message.deleted ? message.sentAt : null,
    // Attachments are static files the view renders itself: media inline,
    // other files as chips that open them.
    attachments: [],
    // Macro users react as themselves; anyone else by their provider name.
    reactions: message.reactions.map((reaction) => {
      const names: Record<string, string> = {};
      const users = reaction.reactors.map((reactor, index) => {
        if (reactor.userId) return reactor.userId;
        const id = `external-reactor:${index}`;
        names[id] = reactor.name;
        return id;
      });
      return { emoji: reaction.emoji, users, names };
    }),
  };
}

/** Consecutive messages from one person group like a channel's. */
export function senderKey(message: ChatMessage): string {
  return message.sender.userId ?? `external:${message.sender.name}`;
}
