import { createQueryKeys } from '@lukemorales/query-key-factory';

export const accessRequestKeys = createQueryKeys('accessRequests', {
  entity: (entityType: string, entityId: string) => ({
    queryKey: [entityType, entityId],
    contextQueries: {
      state: (offset: number) => ({ queryKey: ['state', offset] }),
      grants: null,
    },
  }),
});
