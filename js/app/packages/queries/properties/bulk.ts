import { isErr } from '@core/util/maybeResult';
import { entityPropertyFromApi } from '@core/component/Properties/api/converters';
import type { Property } from '@core/component/Properties/types';
import { queryClient } from '@queries/client';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { UseBaseQueryOptions } from '@tanstack/solid-query';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { partitionByQueryCache } from '../cache';
import { propertiesKeys } from './keys';

export type BulkEntityPropertiesData = Record<string, Property[]>;

type BulkEntityPropertiesQueryOptions = UseBaseQueryOptions<
  BulkEntityPropertiesData,
  Error
>;

type BulkEntityPropertiesParams = {
  readonly entities: readonly EntityReference[];
  readonly propertyDefinitionIds: readonly string[];
};

const entityPropertiesKey = (
  entity: EntityReference,
  propertyDefinitionIds: readonly string[]
) =>
  propertiesKeys.entity({
    entityType: entity.entity_type,
    entityId: entity.entity_id,
    propertyDefinitionIds,
  }).queryKey;

async function getBulkEntityPropertiesCached(
  params: BulkEntityPropertiesParams
): Promise<BulkEntityPropertiesData> {
  if (params.entities.length === 0) return {};

  // 1) Read whatever we already have, per-entity, for this property-id set.
  const { cached, missing } = partitionByQueryCache<EntityReference, Property[]>({
    queryClient,
    items: params.entities,
    queryKeyOf: (entity) => entityPropertiesKey(entity, params.propertyDefinitionIds),
  });

  const out: BulkEntityPropertiesData = {};
  for (const [entity, properties] of cached.entries()) {
    out[entity.entity_id] = properties;
  }

  const entitiesToFetch = [...missing];
  if (entitiesToFetch.length === 0) return out;

  // 2) Fetch missing entities in one API call.
  const result = await propertiesServiceClient.getBulkEntityProperties({
    body: {
      entities: entitiesToFetch,
      property_ids: [...params.propertyDefinitionIds],
    },
  });

  if (isErr(result)) {
    throw new Error('Failed to fetch entity properties', { cause: result[0] });
  }

  // 3) Populate per-entity cache + return merged output.
  const [, data] = result;
  for (const entity of entitiesToFetch) {
    const response = data[entity.entity_id];
    const properties = response ? response.properties.map(entityPropertyFromApi) : [];

    queryClient.setQueryData(
      entityPropertiesKey(entity, params.propertyDefinitionIds),
      properties
    );

    out[entity.entity_id] = properties;
  }

  return out;
}

function bulkEntityPropertiesQueryOptions(params: {
  entities: readonly EntityReference[];
  propertyDefinitionIds: readonly string[];
}): BulkEntityPropertiesQueryOptions {
  return {
    queryKey: propertiesKeys.bulk({
      entities: params.entities,
      propertyDefinitionIds: params.propertyDefinitionIds,
    }).queryKey,
    queryFn: async () => {
      return await getBulkEntityPropertiesCached(params);
    },
  };
}

/**
 * Imperatively fetch bulk properties (deduped + cached) using TanStack Query.
 */
export async function fetchAndCacheBulkEntityProperties(
  entities: readonly EntityReference[],
  propertyDefinitionIds: readonly string[]
): Promise<BulkEntityPropertiesData> {
  return await queryClient.ensureQueryData(
    bulkEntityPropertiesQueryOptions({ entities, propertyDefinitionIds })
  );
}

/**
 * Query hook for fetching properties for many entities in a single API call.
 *
 * Note: we explicitly use the `@queries/client` QueryClient to keep behavior
 * consistent with other query helpers in this package.
 */
export function useBulkEntityPropertiesQuery(
  entities: Accessor<readonly EntityReference[]>,
  propertyDefinitionIds: readonly string[],
  options?: Accessor<
    Omit<BulkEntityPropertiesQueryOptions, 'queryKey' | 'queryFn' | 'initialData'>
  >
) {
  return useQuery(
    () => {
      const currentEntities = entities();
      return {
        // Always provide an object so consumers can treat `data` as total.
        initialData: {},
        enabled: currentEntities.length > 0,
        ...options?.(),
        ...bulkEntityPropertiesQueryOptions({
          entities: currentEntities,
          propertyDefinitionIds,
        }),
      };
    },
    () => queryClient
  );
}


