import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';

export type GroupableMessage = Pick<
  ApiChannelMessage,
  'id' | 'sender_id' | 'created_at' | 'attachments' | 'deleted_at'
> & {
  thread?: Pick<ApiChannelMessage['thread'], 'reply_count'>;
};

export const MESSAGE_GROUPING_WINDOW_MS = 5 * 60 * 1000;

function isDeleted(message: Pick<GroupableMessage, 'deleted_at'>): boolean {
  return message.deleted_at != null;
}

function hasThreadReplies(message: GroupableMessage): boolean {
  return (message.thread?.reply_count ?? 0) > 0;
}

export function shouldGroupWithPreviousMessage(
  current: GroupableMessage,
  previous: GroupableMessage | undefined
): boolean {
  if (!previous) return false;
  if (current.sender_id !== previous.sender_id) return false;
  if (isDeleted(current) || isDeleted(previous)) return false;
  if (hasThreadReplies(previous)) return false;

  const currentCreatedAt = new Date(current.created_at).getTime();
  const previousCreatedAt = new Date(previous.created_at).getTime();
  const timeGap = currentCreatedAt - previousCreatedAt;

  return timeGap >= 0 && timeGap <= MESSAGE_GROUPING_WINDOW_MS;
}
