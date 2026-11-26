import { isSessionArchived } from '@service-agent-harness/session-archive';
import type { AgentsMode } from './mode';
import {
  type AgentConversationEntity,
  conversationTimestamp,
} from './recent-conversations';

/** Select the current user's active coding sessions with open pull requests. */
export function selectOpenPullRequests<Item extends AgentConversationEntity>(
  conversations: readonly Item[],
  ownerId: string | undefined,
  modeForConversation: (conversation: Item) => AgentsMode
): Item[] {
  if (!ownerId) return [];

  return conversations
    .filter(
      (conversation) =>
        conversation.type === 'agent_session' &&
        conversation.ownerId === ownerId &&
        !isSessionArchived(conversation) &&
        modeForConversation(conversation) === 'code' &&
        (conversation.pullRequestState === 'open' ||
          conversation.pullRequestState === 'draft')
    )
    .toSorted(
      (left, right) =>
        conversationTimestamp(right) - conversationTimestamp(left)
    );
}

/** Partition filtered, non-waiting rows while preserving their selected sort order. */
export function partitionOpenPullRequests<Item extends AgentConversationEntity>(
  conversations: readonly Item[],
  ownerId: string | undefined,
  modeForConversation: (conversation: Item) => AgentsMode
) {
  const pinnedIds = new Set(
    selectOpenPullRequests(conversations, ownerId, modeForConversation).map(
      (row) => row.id
    )
  );
  const openPullRequests: Item[] = [];
  const remaining: Item[] = [];
  for (const conversation of conversations) {
    if (pinnedIds.has(conversation.id)) openPullRequests.push(conversation);
    else remaining.push(conversation);
  }
  return { openPullRequests, conversations: remaining };
}
