import type { EntityType } from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';
import { createContext, useContext } from 'solid-js';

export type AgentActivityRow = {
  id: string;
  entityType: EntityType;
  entityId: string;
  action: string;
  verb: string | null;
  occurredAt: string;
};

export type AgentActivitySource = {
  rows: Accessor<AgentActivityRow[]>;
  isPending: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  loadMore: () => void;
};

const AgentActivitySourceContext = createContext<AgentActivitySource>();

export const AgentActivitySourceProvider = AgentActivitySourceContext.Provider;

export function useAgentActivitySource(): AgentActivitySource {
  const source = useContext(AgentActivitySourceContext);
  if (!source) throw new Error('AgentActivitySourceProvider is missing');
  return source;
}
