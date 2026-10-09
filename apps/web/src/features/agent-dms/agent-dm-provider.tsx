import { type ParentProps, Show } from 'solid-js';
import { AgentDmContext } from './context';
import { useAgentDmConversation } from './queries/conversation';

/** Ordinary channels never load agent conversation state. */
export function AgentDmProvider(
  props: ParentProps<{ channelId: string; isAgentDm: boolean }>
) {
  return (
    <Show when={props.isAgentDm} fallback={props.children}>
      <ConversationProvider channelId={props.channelId}>
        {props.children}
      </ConversationProvider>
    </Show>
  );
}

function ConversationProvider(props: ParentProps<{ channelId: string }>) {
  const query = useAgentDmConversation(() => props.channelId);
  return (
    <AgentDmContext.Provider
      value={{
        conversation: () => (query.isSuccess ? query.data : undefined),
        refresh: () => void query.refetch(),
      }}
    >
      {props.children}
    </AgentDmContext.Provider>
  );
}
