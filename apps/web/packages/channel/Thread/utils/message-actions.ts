import { getChannelParams } from '@channel/Channel/link';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { MessageData } from '../../Message';

export const DEFAULT_REACTION_EMOJI = '👍';
const EMPTY_REPLY_PARAGRAPH = ' ';
const BOT_SENDER_PREFIX = 'bot|';

export type ActionableMessage = Pick<
  MessageData,
  'id' | 'sender_id' | 'deleted_at' | 'reactions' | 'content'
> & {
  thread_id?: string | null;
};

export function isOwnMessage(
  message: Pick<ActionableMessage, 'sender_id'>,
  currentUserId: string | undefined
): boolean {
  if (!currentUserId) return false;
  return message.sender_id === currentUserId;
}

export function isBotMessage(
  message: Pick<ActionableMessage, 'sender_id'>
): boolean {
  return message.sender_id.startsWith(BOT_SENDER_PREFIX);
}

export function canEditMessage(
  message: Pick<ActionableMessage, 'sender_id' | 'deleted_at'>,
  currentUserId: string | undefined
): boolean {
  return isOwnMessage(message, currentUserId) && !message.deleted_at;
}

export function canDeleteMessage(
  message: Pick<ActionableMessage, 'sender_id' | 'deleted_at'>,
  currentUserId: string | undefined
): boolean {
  return (
    (isOwnMessage(message, currentUserId) || isBotMessage(message)) &&
    !message.deleted_at
  );
}

export function canReplyToMessage(
  message: Pick<ActionableMessage, 'thread_id' | 'deleted_at'>
): boolean {
  return !message.deleted_at;
}

export function buildQuoteReplyValue(input: {
  quotedContent: string;
  existingValue?: string;
}): string {
  const normalizedQuotedContent = input.quotedContent
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*>+\s?/, ''))
    .join('\n')
    .trim();
  const existingValue = input.existingValue?.trimStart() ?? '';

  if (!normalizedQuotedContent) return existingValue;

  const quote = normalizedQuotedContent
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

  return existingValue
    ? `${quote}\n\n${existingValue}`
    : `${quote}\n\n${EMPTY_REPLY_PARAGRAPH}`;
}

export function hasReactionFromUser(
  message: Pick<ActionableMessage, 'reactions'>,
  emoji: string,
  userId: string | undefined
): boolean {
  if (!userId) return false;
  return message.reactions.some(
    (reaction) => reaction.emoji === emoji && reaction.users.includes(userId)
  );
}

export function buildMessageLink(
  channelId: string,
  messageId: string,
  threadId?: string | null
): string {
  const params = getChannelParams(messageId, threadId);
  return buildSimpleEntityUrl({ type: 'channel', id: channelId }, params);
}
