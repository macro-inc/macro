import type {
  ApiChannelMessage,
  ApiThreadReply,
  ChannelMessagesPage,
} from '@service-storage/client';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';

type WithMaybeSender<
  T extends { sender_id: string; sender: ApiMessageSender },
> = Omit<T, 'sender'> & { sender?: ApiMessageSender };

export type ThreadReplyWithMaybeSender = WithMaybeSender<ApiThreadReply>;

export type ChannelMessageWithMaybeSender = Omit<
  WithMaybeSender<ApiChannelMessage>,
  'thread'
> & {
  thread: Omit<ApiChannelMessage['thread'], 'preview'> & {
    preview: ThreadReplyWithMaybeSender[];
  };
};

// Temporary compatibility for API nodes that only return sender_id.
// Remove once all deployed channel message responses include sender.
export function senderFromStorageId(senderId: string): ApiMessageSender {
  if (senderId.startsWith('bot|')) {
    return { type: 'bot', id: senderId.slice('bot|'.length) };
  }

  return { type: 'user', id: senderId };
}

export function normalizeMessageSender<
  T extends { sender_id: string; sender?: ApiMessageSender },
>(message: T): T & { sender: ApiMessageSender } {
  return message.sender
    ? (message as T & { sender: ApiMessageSender })
    : { ...message, sender: senderFromStorageId(message.sender_id) };
}

export function normalizeThreadReplySender(
  reply: ThreadReplyWithMaybeSender
): ApiThreadReply {
  return normalizeMessageSender(reply);
}

export function normalizeChannelMessageSender(
  message: ChannelMessageWithMaybeSender
): ApiChannelMessage {
  const normalized = normalizeMessageSender(message);

  return {
    ...normalized,
    thread: {
      ...normalized.thread,
      preview: normalized.thread.preview.map(normalizeThreadReplySender),
    },
  };
}

export function normalizeChannelMessagesPageSenders(
  page: Omit<ChannelMessagesPage, 'items'> & {
    items: ChannelMessageWithMaybeSender[];
  }
): ChannelMessagesPage {
  return {
    ...page,
    items: page.items.map(normalizeChannelMessageSender),
  };
}
