import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import type { PropertyScope } from '../../service-clients/service-properties/generated/schemas/propertyScope';

export const propertiesKeys = createQueryKeys('properties', {
  all: null,
  entity: (params: {
    entityType: EntityType;
    entityId: string;
    includeMetadata?: boolean;
  }) => ({
    queryKey:
      params.includeMetadata !== undefined
        ? ['entity', params.entityType, params.entityId, params.includeMetadata]
        : ['entity', params.entityType, params.entityId],
  }),
  options: (params: { propertyDefinitionId: string }) => ({
    queryKey: ['options', params.propertyDefinitionId],
  }),
  definitions: (params: {
    scope: PropertyScope;
    includeOptions: boolean;
    forEntityType?: EntityType;
  }) => ({
    queryKey: [
      'definitions',
      params.scope,
      params.includeOptions,
      params.forEntityType,
    ],
  }),
});
