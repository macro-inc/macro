import {
  type GroupableMessage,
  shouldGroupWithPreviousMessage,
} from '../../Channel/message-grouping-meta';

export const DEFAULT_VISIBLE_REPLY_GROUP_COUNT = 3;

type ThreadReplyMeta = {
  sender_id: string;
  created_at: string;
};

/** Keep complete avatar groups visible, including every reply in the last group. */
export function getVisibleReplyCount(
  replies: ReadonlyArray<GroupableMessage>,
  maxGroups: number = DEFAULT_VISIBLE_REPLY_GROUP_COUNT
): number {
  let groupCount = 0;
  for (let index = 0; index < replies.length; index += 1) {
    if (!shouldGroupWithPreviousMessage(replies[index], replies[index - 1])) {
      groupCount += 1;
      if (groupCount > maxGroups) return index;
    }
  }
  return replies.length;
}

export function getCollapsedRepliesCount(
  totalReplies: number,
  visibleReplies: number
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
