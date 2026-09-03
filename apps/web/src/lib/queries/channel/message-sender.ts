import { CURSOR_BOT_NAME, isCursorBotId } from '@core/constant/cursorAgent';
import { isMacroAgentId, MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { isMacroCoderId, MACRO_CODER_NAME } from '@core/constant/macroCoder';
import { isMacroNewId, MACRO_NEW_NAME } from '@core/constant/macroNew';
import type {
  ApiChannelMessage,
  ApiThreadReply,
  ChannelMessagesPage,
} from '@service-storage/client';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';
import type { Bot } from '@service-storage/generated/schemas/bot';

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

function systemBotDisplayName(id: string): string | undefined {
  if (isMacroAgentId(id)) return MACRO_AGENT_NAME;
  if (isMacroCoderId(id)) return MACRO_CODER_NAME;
  if (isMacroNewId(id)) return MACRO_NEW_NAME;
  if (isCursorBotId(id)) return CURSOR_BOT_NAME;
  return undefined;
}

/** Resolve a channel bot sender to its display name. */
export function getBotDisplayName(
  senderId: string,
  sender?: ApiMessageSender,
  bots: readonly Pick<Bot, 'id' | 'name'>[] = []
): string | undefined {
  const parsed = sender ?? senderFromStorageId(senderId);
  const systemName =
    systemBotDisplayName(parsed.id) ?? systemBotDisplayName(senderId);

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
