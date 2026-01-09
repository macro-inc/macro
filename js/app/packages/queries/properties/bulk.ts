import type { UseBaseQueryOptions } from '@tanstack/solid-query';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityPropertyFromApi } from '../../core/component/Properties/api/converters';
import type { Property } from '../../core/component/Properties/types';
import { isErr } from '../../core/util/maybeResult';
import { propertiesServiceClient } from '../../service-clients/service-properties/client';
import type { EntityReference } from '../../service-clients/service-properties/generated/schemas/entityReference';
import { partitionByQueryCache } from '../cache';
import { queryClient } from '../client';
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

async function fetchBulkWithCachePartition(
  params: BulkEntityPropertiesParams
): Promise<BulkEntityPropertiesData> {
  if (params.entities.length === 0) return {};

  const { cached, missing } = partitionByQueryCache<
    EntityReference,
    Property[]
  >({
    queryClient,
    items: params.entities,
    queryKeyOf: (entity) =>
      entityPropertiesKey(entity, params.propertyDefinitionIds),
  });

  const out: BulkEntityPropertiesData = {};
  for (const [entity, properties] of cached.entries()) {
    out[entity.entity_id] = properties;
  }

  if (missing.length === 0) return out;

  const result = await propertiesServiceClient.getBulkEntityProperties({
    body: {
      entities: [...missing],
      property_ids: [...params.propertyDefinitionIds],
    },
  });

  if (isErr(result)) {
    throw new Error('Failed to fetch entity properties', { cause: result[0] });
  }

  const [, data] = result;
  for (const entity of missing) {
    const response = data[entity.entity_id];
    if (!response) {
      out[entity.entity_id] = [];
      continue;
    }

    const properties = response.properties.map(entityPropertyFromApi);
    queryClient.setQueryData(
      entityPropertiesKey(entity, params.propertyDefinitionIds),
      properties
    );
    out[entity.entity_id] = properties;
  }

  return out;
}

function bulkEntityPropertiesQueryOptions(
  params: BulkEntityPropertiesParams
): BulkEntityPropertiesQueryOptions {
  return {
    queryKey: propertiesKeys.bulk({
      entities: params.entities,
      propertyDefinitionIds: params.propertyDefinitionIds,
    }).queryKey,
    queryFn: () => fetchBulkWithCachePartition(params),
  };
}

export function useBulkEntityPropertiesQuery(
  entities: Accessor<readonly EntityReference[]>,
  propertyDefinitionIds: readonly string[],
  options?: Accessor<
    Omit<
      BulkEntityPropertiesQueryOptions,
      'queryKey' | 'queryFn' | 'initialData'
    >
  >
) {
  return useQuery(
    () => {
      const currentEntities = entities();
      const placeholder: BulkEntityPropertiesData = {};
      for (const entity of currentEntities) {
        const cached = queryClient.getQueryData<Property[]>(
          entityPropertiesKey(entity, propertyDefinitionIds)
        );
        placeholder[entity.entity_id] = cached ?? [];
      }
      return {
        initialData: placeholder,
        staleTime: 0,
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
