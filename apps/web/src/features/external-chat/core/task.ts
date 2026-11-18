import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import type { ChatDetail, ChatMessage } from './chat';
import { mentionPattern } from './mentions';
import type { Mention } from './rich';

const TITLE_LENGTH = 70;

/** A message as a new task, the way Chat creates one from a message. */
export type MessageTask = {
  title: string;
  /** A mention that opens the chat. */
  content: string;
  /** Macro users the message mentions. */
  assigneeIds: string[];
};

/**
 * The message's text with each mention as `@<name>`. Macro users mentioned
 * at either end are left out: they become the assignees, as in Chat.
 */
function titleText(message: ChatMessage): string {
  const pattern = mentionPattern(message.mentions);
  if (!pattern) return message.body.trim();

  const parts: (string | Mention)[] = [];
  let last = 0;
  for (const found of message.body.matchAll(pattern)) {
    const mention = message.mentions.find((each) => each.token === found[1]);
    if (!mention) continue;
    parts.push(message.body.slice(last, found.index), mention);
    last = found.index + found[0].length;
  }
  parts.push(message.body.slice(last));

  const atEdge = (part: string | Mention | undefined) =>
    typeof part === 'string' ? part.trim() === '' : !!part?.userId;
  while (parts.length > 0 && atEdge(parts[0])) parts.shift();
  while (parts.length > 0 && atEdge(parts.at(-1))) parts.pop();

  return parts
    .map((part) => (typeof part === 'string' ? part : `@${part.name}`))
    .join('')
    .trim();
}

/**
 * Anyone who can see the chat can make a task from a message; pending,
 * deleted and system rows have none.
 */
export function messageTask(
  message: ChatMessage,
  chat: Pick<ChatDetail, 'id' | 'name'>
): MessageTask | undefined {
  if (message.pending || message.deleted) return undefined;
  if (message.kind === 'system') return undefined;

  const text = titleText(message);
  const assigneeIds = message.mentions.flatMap((mention) =>
    mention.userId ? [mention.userId] : []
  );

  return {
    title:
      text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH)}...` : text,
    content: buildMentionMarkdownString({
      type: 'document',
      documentId: chat.id,
      documentName: chat.name,
      blockName: 'external_chat',
    }),
    assigneeIds: [...new Set(assigneeIds)],
  };
}
