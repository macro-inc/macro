import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentToolPermissionKeys = createQueryKeys(
  'agent-tool-permissions',
  {
    catalog: null,
    agent: (agentId: string) => [agentId],
    session: (sessionId: string) => [sessionId],
  }
);
