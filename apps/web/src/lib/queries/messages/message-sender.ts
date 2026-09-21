import type { Bot } from '@service-storage/generated/schemas/bot';
import type {
  Message as EntityMessage,
  MessageListItem,
  MessageSender,
  MessageTimelinePage,
} from '@service-storage/messages';
import { firstPartyBotName } from '../bots/first-party-bot-name';

export { firstPartyBotName } from '../bots/first-party-bot-name';

type WithMaybeSender<
  T extends {
    sender_id: string;
    sender?: MessageSender;
    bot_profile?: { name: string; avatar_url?: string | null } | null;
    triggered_by?: string | null;
  },
> = Omit<T, 'sender'> & { sender?: MessageSender };

export type ThreadReplyWithMaybeSender = WithMaybeSender<EntityMessage>;

export type ChannelMessageWithMaybeSender = Omit<
  WithMaybeSender<MessageListItem>,
  'thread'
> & {
  thread: Omit<MessageListItem['thread'], 'preview'> & {
    preview: ThreadReplyWithMaybeSender[];
  };
};

/** Derive presentation identity from the canonical stored principal. */
export function senderFromStorageId(senderId: string): MessageSender {
  if (senderId.startsWith('bot|')) {
    return { type: 'bot', id: senderId.slice('bot|'.length) };
  }

  return { type: 'user', id: senderId };
}

/** Resolve a channel bot sender to its display name. */
export function getBotDisplayName(
  senderId: string,
  sender?: MessageSender,
  bots: readonly Pick<Bot, 'id' | 'name'>[] = []
): string | undefined {
  const parsed = sender ?? senderFromStorageId(senderId);
  const systemName =
    firstPartyBotName(parsed.id) ?? firstPartyBotName(senderId);

  if (parsed.type !== 'bot' && !systemName) return undefined;

  return (
    parsed.name ??
    systemName ??
    bots.find((bot) => bot.id === parsed.id)?.name ??
    'Bot'
  );
}

export function isBotSenderId(senderId: string): boolean {
  return senderFromStorageId(senderId).type === 'bot';
}

export function normalizeMessageSender<
  T extends {
    sender_id: string;
    sender?: MessageSender;
    bot_profile?: { name: string; avatar_url?: string | null } | null;
    triggered_by?: string | null;
  },
>(message: T): T & { sender: MessageSender } {
  return message.sender
    ? (message as T & { sender: MessageSender })
    : {
        ...message,
        sender: {
          ...senderFromStorageId(message.sender_id),
          ...message.bot_profile,
          triggered_by: message.triggered_by,
        },
      };
}

export function normalizeThreadReplySender(
  reply: ThreadReplyWithMaybeSender
): EntityMessage {
  return normalizeMessageSender(reply);
}

export function normalizeChannelMessageSender(
  message: ChannelMessageWithMaybeSender
): MessageListItem {
  const normalized = normalizeMessageSender(message);

  return {
    ...normalized,
    thread: {
      ...normalized.thread,
      preview: normalized.thread.preview.map(normalizeThreadReplySender),
    },
  };
}

export function normalizeMessageTimelinePageSenders(
  page: Omit<MessageTimelinePage, 'items'> & {
    items: ChannelMessageWithMaybeSender[];
  }
): MessageTimelinePage {
  return {
    ...page,
    items: page.items.map(normalizeChannelMessageSender),
  };
}
