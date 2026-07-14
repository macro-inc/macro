export const DEFAULT_VISIBLE_REPLY_COUNT = 3;

type ThreadReplyMeta = {
  sender_id: string;
  created_at: string;
};

export function getCollapsedRepliesCount(
  totalReplies: number,
  visibleReplies: number = DEFAULT_VISIBLE_REPLY_COUNT
): number {
  return Math.max(totalReplies - visibleReplies, 0);
}

export function getThreadReplyCountLabel(
  collapsedRepliesCount: number
): string {
  return `${collapsedRepliesCount} more repl${
    collapsedRepliesCount === 1 ? 'y' : 'ies'
  }`;
}

export function getUniqueReplyUserIds(
  replies: ReadonlyArray<Pick<ThreadReplyMeta, 'sender_id'>>,
  maxUsers?: number
): string[] {
  const seenUserIds = new Set<string>();
  const uniqueUserIds: string[] = [];

  for (const reply of replies) {
    if (seenUserIds.has(reply.sender_id)) continue;
    seenUserIds.add(reply.sender_id);
    uniqueUserIds.push(reply.sender_id);
    if (maxUsers !== undefined && uniqueUserIds.length === maxUsers) break;
  }

  return uniqueUserIds;
}

export function getThreadLatestReplyAt(
  latestReplyAt: string | null | undefined,
  replies: ReadonlyArray<Pick<ThreadReplyMeta, 'created_at'>>
): string | undefined {
  return latestReplyAt ?? replies.at(-1)?.created_at;
}
