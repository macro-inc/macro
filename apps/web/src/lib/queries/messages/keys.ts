import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { MessageParent } from '@service-storage/messages';
export const messageKeys = createQueryKeys('messages', {
  messages: (
    parent: MessageParent,
    loadAroundMessageId: string | null = null
  ) => ({ queryKey: [parent, { loadAroundMessageId }] }),
  messagesByIds: (parent: MessageParent, messageIds: string[]) => ({
    queryKey: [parent, { messageIds }],
  }),
  threadReplies: (parent: MessageParent, rootId: string) => ({
    queryKey: [parent, rootId],
  }),
  resolveMessage: (parent: MessageParent, messageId: string) => ({
    queryKey: [parent, messageId],
  }),
});
export const MessageNonceKeys = {
  MESSAGE: 'message',
  REACTION: 'message-reaction',
} as const;
export const parentKey = (parent: MessageParent) =>
  `${parent.type}:${parent.id}`;
