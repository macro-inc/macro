import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';

/**
 * Cached entity property values. The catalog (definitions, options, tag sets)
 * lives in the GraphQL normalized cache; see `catalog/`.
 */
export const propertiesKeys = createQueryKeys('properties', {
  entity: (params: { entityType: EntityType; entityId: string }) => ({
    queryKey: ['entity', params.entityType, params.entityId],
  }),
});
