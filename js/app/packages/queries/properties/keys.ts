import { createQueryKeys } from '@lukemorales/query-key-factory';
import { uniqueByKeySorted } from '../../core/util/compareUtils';
import type { EntityReference } from '../../service-clients/service-properties/generated/schemas/entityReference';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';

const normalizeStringIds = (ids: readonly string[]) => [...new Set(ids)].sort();

const entityRefKey = (e: EntityReference) => `${e.entity_type}:${e.entity_id}`;

const normalizeEntities = (entities: readonly EntityReference[]) =>
  uniqueByKeySorted(entities, entityRefKey);

export const propertiesKeys = createQueryKeys('properties', {
  all: null,

  entity: (params: {
    entityType: EntityType;
    entityId: string;
    propertyDefinitionIds?: readonly string[] | undefined;
  }) => ({
    queryKey: [
      'entity',
      params.entityType,
      params.entityId,
      params.propertyDefinitionIds
        ? normalizeStringIds(params.propertyDefinitionIds)
        : undefined,
    ],
  }),

  bulk: (params: {
    entities: readonly EntityReference[];
    propertyDefinitionIds: readonly string[];
  }) => ({
    queryKey: [
      'bulk',
      {
        entities: normalizeEntities(params.entities),
        propertyDefinitionIds: normalizeStringIds(params.propertyDefinitionIds),
      },
    ],
  }),
});
