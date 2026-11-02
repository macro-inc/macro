import type { AgentsMode } from './mode';
import {
  type AgentConversationEntity,
  conversationTimestamp,
} from './recent-conversations';

/** Select the current user's active coding sessions with open pull requests. */
export function selectOpenPullRequests(
  conversations: readonly AgentConversationEntity[],
  ownerId: string | undefined,
  modeForConversation: (conversation: AgentConversationEntity) => AgentsMode
): AgentConversationEntity[] {
  if (!ownerId) return [];

  return conversations
    .filter(
      (conversation) =>
        conversation.type === 'agent_session' &&
        conversation.ownerId === ownerId &&
        !conversation.isArchived &&
        modeForConversation(conversation) === 'code' &&
        (conversation.pullRequestState === 'open' ||
          conversation.pullRequestState === 'draft')
    )
    .toSorted(
      (left, right) =>
        conversationTimestamp(right) - conversationTimestamp(left)
    );
}
