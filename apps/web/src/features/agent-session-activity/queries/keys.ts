import { createQueryKeys } from '@lukemorales/query-key-factory';

export const agentSessionActivityKeys = createQueryKeys(
  'agentSessionActivity',
  {
    session: (sessionId: string) => ({ queryKey: [sessionId] }),
  }
);
