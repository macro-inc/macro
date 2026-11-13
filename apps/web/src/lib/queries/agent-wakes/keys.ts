import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { AgentWakesFilter } from '@service-agent-harness/agent-wakes';

export const agentWakeKeys = createQueryKeys('agentWakes', {
  list: (agentId: string, filter: AgentWakesFilter) => [agentId, filter],
  trace: (agentId: string, wakeId: string) => [agentId, wakeId],
});
