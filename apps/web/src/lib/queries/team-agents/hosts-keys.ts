import { createQueryKeys } from '@lukemorales/query-key-factory';

export const teammateHostKeys = createQueryKeys('teammate-hosts', {
  list: (teamId: string) => [teamId],
});
