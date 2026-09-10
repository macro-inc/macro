import { getChannelParams } from '@channel/Channel/link';
import { buildSimpleEntityUrl } from '@core/util/url';
import {
  buildReplyTargetMarkdown,
  markdownToPlainText,
  stripLeadingReplyTargetMarkdown,
} from '@macro-inc/lexical-core';
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

function oneLinePreview(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function stripMagicChipMarkdown(markdown: string): string {
  return markdown.replace(/<m-magic-chip>.*?<\/m-magic-chip>/gs, '');
}

export function buildReplyTargetValue(input: {
  channelId: string;
  message: Pick<MessageData, 'id' | 'content' | 'sender_id' | 'thread_id'>;
  selectedText?: string;
  renderedText?: string;
  existingValue?: string;
}): string {
  if (!input.message.thread_id) return input.existingValue ?? '';

  const messageText = markdownToPlainText(
    stripMagicChipMarkdown(
      stripLeadingReplyTargetMarkdown(input.message.content)
    )
  );
  const displayText = oneLinePreview(
    input.selectedText || input.renderedText || messageText
  );
  const replyTarget = buildReplyTargetMarkdown({
    channelId: input.channelId,
    targetMessageId: input.message.id,
    targetThreadId: input.message.thread_id,
    displayText,
    senderId: input.message.sender_id,
  });
  const existingValue = input.existingValue?.trimStart() ?? '';

  return existingValue
    ? `${replyTarget}\n\n${existingValue}`
    : `${replyTarget}\n\n${EMPTY_REPLY_PARAGRAPH}`;
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
