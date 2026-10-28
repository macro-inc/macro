import { throwOnErr } from '@core/util/result';
import { getTypingAgents } from '@queries/messages/typing';
import {
  type AgentConversation,
  listAgentConversations,
} from '@service-agent-harness/agent-conversations';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

export const agentConversationsKey = (channelId: string) =>
  ['agent-conversations', channelId] as const;

/** While a turn moves: whether it is queued, how it ended, and its Retry. */
const ACTIVE_POLL_MS = 5_000;
/** Otherwise only what rarely changes: access, settings, a fresh context. */
const IDLE_POLL_MS = 60_000;

function turnInFlight(conversations: readonly AgentConversation[] | undefined) {
  return (
    conversations?.some((conversation) =>
      conversation.turns.some(
        (turn) => turn.state === 'queued' || turn.state === 'running'
      )
    ) ?? false
  );
}

// Cached on the query past unmount; module scope keeps hook state out of it.
function agentConversationsQueryOptions(
  channelId: string,
  enabled: boolean,
  typingUntil: number
) {
  return queryOptions({
    queryKey: agentConversationsKey(channelId),
    queryFn: ({ signal }) =>
      throwOnErr(() => listAgentConversations(channelId, signal)),
    refetchInterval: (query) =>
      typingUntil >= query.state.dataUpdatedAt || turnInFlight(query.state.data)
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/**
 * Only the open channel polls for context and eligibility changes, and only
 * while `enabled` says an agent converses there: every few seconds while a
 * turn is queued or running, about once a minute otherwise.
 */
export function useAgentConversations(
  channelId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  // An agent typing here has a turn running before a poll has seen it. Its
  // typing stops as the turn ends; until a poll lands after that, polling
  // stays fast, so a turn that failed shows its Retry without the idle wait.
  const typingUntil = createMemo<number>((until) => {
    if (getTypingAgents({ type: 'channel', id: channelId() }).size > 0)
      return Number.POSITIVE_INFINITY;
    return until === Number.POSITIVE_INFINITY ? Date.now() : until;
  }, 0);
  return useQuery(() =>
    agentConversationsQueryOptions(channelId(), enabled(), typingUntil())
  );
}
