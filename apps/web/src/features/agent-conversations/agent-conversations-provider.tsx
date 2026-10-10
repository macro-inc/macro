import { queryReadyGate } from '@queries/gate';
import type { ParentProps } from 'solid-js';
import { AgentConversationsContext } from './context';
import { useAgentConversations } from './queries/conversations';

/**
 * Channels without a conversing agent never load conversation state. The
 * provider is the same either way, so a channel whose metadata names its
 * agent only after the channel first rendered is not mounted again.
 */
export function AgentConversationsProvider(
  props: ParentProps<{ channelId: string; hasAgents: boolean }>
) {
  const query = useAgentConversations(
    () => props.channelId,
    () => props.hasAgents
  );
  return (
    <AgentConversationsContext.Provider
      value={{
        // A failed poll keeps the last answer: statuses and Retry stay put
        // until the next poll succeeds.
        conversations: () =>
          props.hasAgents && queryReadyGate(query) ? query.data : undefined,
        refresh: () => void query.refetch(),
      }}
    >
      {props.children}
    </AgentConversationsContext.Provider>
  );
}
