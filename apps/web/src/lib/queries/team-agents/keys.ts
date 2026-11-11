import { createQueryKeys } from '@lukemorales/query-key-factory';

export const teamAgentKeys = createQueryKeys('team-agents', {
  list: (teamId: string) => [teamId],
});
