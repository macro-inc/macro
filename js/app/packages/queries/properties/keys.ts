import { createQueryKeys } from '@lukemorales/query-key-factory';
import { uniqueByKeySorted } from '@core/util/compareUtils';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';

const normalizeStringIds = (ids: readonly string[]) =>
  [...new Set(ids)].slice().sort();

const entityRefKey = (e: EntityReference) => `${e.entity_type}:${e.entity_id}`;

const normalizeEntities = (entities: readonly EntityReference[]) =>
  uniqueByKeySorted(entities, entityRefKey);

export const propertiesKeys = createQueryKeys('properties', {
  all: null,

  /**
   * Cache key for a specific entity's properties for a given set of propertyDefinitionIds.
   * (The ids are normalized to keep keys stable.)
   */
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

  /**
   * Cache key for fetching many entities' properties in a single request.
   * (Entities + ids are normalized to keep keys stable.)
   */
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


