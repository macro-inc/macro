import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityPropertyFromApi } from '../../core/component/Properties/api/converters';
import type { Property } from '../../core/component/Properties/types';
import { isErr } from '../../core/util/maybeResult';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import { queryClient } from '../client';
import { propertiesKeys } from './keys';

export type BulkEntityPropertiesData = Record<string, Property[]>;

/**
 * Fetches properties for multiple entities of the same type.
 * No caching partitioning - just a simple bulk fetch.
 */
async function fetchBulkProperties(
  entityType: EntityType,
  entityIds: readonly string[],
  propertyDefinitionIds: readonly string[]
): Promise<BulkEntityPropertiesData> {
  if (entityIds.length === 0) return {};

  const entities = entityIds.map((id) => ({
    entity_type: entityType,
    entity_id: id,
  }));

  const result = await propertiesServiceClient.getBulkEntityProperties({
    body: {
      entities,
      property_ids: [...propertyDefinitionIds],
    },
  });

  if (isErr(result)) {
    throw new Error('Failed to fetch entity properties', { cause: result[0] });
  }

  const [, data] = result;
  const out: BulkEntityPropertiesData = {};

  for (const entityId of entityIds) {
    const response = data[entityId];
    out[entityId] = response?.properties.map(entityPropertyFromApi) ?? [];
  }

  return out;
}

/**
 * Hook for fetching properties for multiple entities.
 * Simple query without complex caching logic.
 */
export function useBulkEntityPropertiesQuery(
  entityType: EntityType,
  entityIds: Accessor<readonly string[]>,
  propertyDefinitionIds: readonly string[]
) {
  return useQuery(
    () => ({
      queryKey: propertiesKeys.bulk({
        entityType,
        entityIds: entityIds(),
      }).queryKey,
      queryFn: () =>
        fetchBulkProperties(entityType, entityIds(), propertyDefinitionIds),
      enabled: entityIds().length > 0,
    }),
    () => queryClient
  );
}
