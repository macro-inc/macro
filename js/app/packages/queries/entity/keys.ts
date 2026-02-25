import { createQueryKeys } from '@lukemorales/query-key-factory';

export const entityKeys = createQueryKeys('entity', {
  permissions: (entityType: string, entityId: string) => ({
    queryKey: [entityType, entityId],
  }),
});
