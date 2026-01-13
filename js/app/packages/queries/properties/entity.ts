import { throwOnErr } from '@core/util/maybeResult';
import { type QueryKey, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityPropertyFromApi } from '../../core/component/Properties/api/converters';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityType } from '../../service-clients/service-properties/generated/schemas/entityType';
import { queryClient } from '../client';
import { propertiesKeys } from './keys';

/**
 * Query hook for fetching properties for a single entity.
 */
export function useEntityPropertiesQuery(
  entityType: Accessor<EntityType>,
  entityId: Accessor<string>,
  includeMetadata: boolean
) {
  return useQuery(
    () => ({
      queryKey: propertiesKeys.entity({
        entityType: entityType(),
        entityId: entityId(),
      }).queryKey,
      queryFn: async () => {
        const data = await throwOnErr(
          async () =>
            await propertiesServiceClient.getEntityProperties({
              entity_type: entityType(),
              entity_id: entityId(),
              query: { include_metadata: includeMetadata },
            })
        );
        return data.properties.map(entityPropertyFromApi);
      },
      staleTime: 0,
    }),
    () => queryClient
  );
}

function bulkIncludesEntityPredicate(queryKey: QueryKey, entityId: string) {
  return (
    queryKey.includes('properties') &&
    queryKey.includes('bulk') &&
    queryKey.some(
      (subKey) => Array.isArray(subKey) && subKey.includes(entityId)
    )
  );
}

/**
 * Invalidates and refetches all property queries for a specific entity.
 */
export function invalidatePropertiesForEntity(
  entityType: EntityType,
  entityId: string
) {
  queryClient.invalidateQueries({
    queryKey: propertiesKeys.entity({ entityType, entityId }).queryKey,
  });

  // This invalidates any bulk query including this entity
  queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      bulkIncludesEntityPredicate(queryKey, entityId),
  });
}
