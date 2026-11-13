import { createContext, type ParentProps, useContext } from 'solid-js';

/**
 * The agent a view belongs to, for agent panes that name none: a dashboard
 * page provides its agent account here. Without a provider, a pane must name
 * its agent.
 */
const AgentScopeContext = createContext<() => string | undefined>(
  () => undefined
);

export function AgentScope(
  props: ParentProps<{ agentId: string | undefined }>
) {
  return (
    <AgentScopeContext.Provider value={() => props.agentId}>
      {props.children}
    </AgentScopeContext.Provider>
  );
}

/** The pane's own agent id, else the view's agent. */
export function useScopedAgentId(
  agentId: () => string | undefined
): () => string | undefined {
  const scoped = useContext(AgentScopeContext);
  return () => agentId() ?? scoped();
}
