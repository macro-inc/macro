import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';

export const propertiesKeys = createQueryKeys('properties', {
  all: null,
  entity: (params: { entityType: EntityType; entityId: string }) => ({
    queryKey: ['entity', params.entityType, params.entityId],
  }),
  bulk: (params: { entityType: EntityType; entityIds: readonly string[] }) => ({
    queryKey: ['bulk', params.entityType, [...params.entityIds].sort()],
  }),
});
