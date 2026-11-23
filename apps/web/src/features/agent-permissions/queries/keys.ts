import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentToolPermissionKeys = createQueryKeys(
  'agent-tool-permissions',
  {
    catalog: null,
    agent: (agentId: string) => [agentId],
    session: (sessionId: string) => [sessionId],
    sources: (query: { agentId?: string; scope?: string; teamId?: string }) => [
      query,
    ],
    policy: (policyId: string) => [policyId],
    team: (teamId: string) => [teamId],
  }
);
