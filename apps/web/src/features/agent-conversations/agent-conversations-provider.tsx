import { type ParentProps, Show } from 'solid-js';
import { AgentConversationsContext } from './context';
import { useAgentConversations } from './queries/conversations';

/** Channels without a conversing agent never load conversation state. */
export function AgentConversationsProvider(
  props: ParentProps<{ channelId: string; hasAgents: boolean }>
) {
  return (
    <Show when={props.hasAgents} fallback={props.children}>
      <ConversationsProvider channelId={props.channelId}>
        {props.children}
      </ConversationsProvider>
    </Show>
  );
}

function ConversationsProvider(props: ParentProps<{ channelId: string }>) {
  const query = useAgentConversations(() => props.channelId);
  return (
    <AgentConversationsContext.Provider
      value={{
        conversations: () => (query.isSuccess ? query.data : undefined),
        refresh: () => void query.refetch(),
      }}
    >
      {props.children}
    </AgentConversationsContext.Provider>
  );
}
