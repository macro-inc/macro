import type { EntityType } from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

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
