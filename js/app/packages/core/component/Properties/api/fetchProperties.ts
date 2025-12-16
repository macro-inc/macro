import { isErr } from '@core/util/maybeResult';
import { queryClient } from '@queries/client';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, Result } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';
import { entityPropertyFromApi } from './converters';

/**
 * Query keys for properties cache.
 *
 * Cache is keyed by (entity + propertyDefinitionIds set) rather than per individual property.
 * This is simpler and sufficient because:
 * 1. Our main consumer (useTaskProperties) always requests the same fixed set of properties
 * 2. Per-property caching wouldn't save API calls anyway - if any property is missing,
 *    we'd still need to fetch all requested properties for that entity
 */
export const propertyQueryKeys = {
  all: ['properties'] as const,
  entity: (
    entityType: EntityType,
    entityId: string,
    propertyDefinitionIds?: string[]
  ) =>
    [
      ...propertyQueryKeys.all,
      'entity',
      entityType,
      entityId,
      propertyDefinitionIds?.sort(),
    ] as const,
};

/**
 * Fetch all properties for an entity.
 * Returns a Result type for backward compatibility with existing hooks.
 */
export async function fetchEntityProperties(
  entityId: string,
  entityType: EntityType,
  includeMetadata: boolean
): Promise<Result<Property[]>> {
  try {
    const result = await propertiesServiceClient.getEntityProperties({
      entity_type: entityType,
      entity_id: entityId,
      query: {
        include_metadata: includeMetadata,
      },
    });

    if (isErr(result)) {
      console.error(
        'api.properties.fetchEntityProperties:',
        result,
        ERROR_MESSAGES.PROPERTY_FETCH
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: ERROR_MESSAGES.PROPERTY_FETCH,
        },
      };
    }

    const [, data] = result;
    const properties = data.properties.map(entityPropertyFromApi);

    return { ok: true, value: properties };
  } catch (error) {
    console.error(
      'api.properties.fetchEntityProperties:',
      error,
      ERROR_MESSAGES.PROPERTY_FETCH
    );
    return {
      ok: false,
      error: {
        code: 'EXCEPTION',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Fetch properties for multiple entities in bulk.
 * Uses TanStack Query cache - only fetches entities not already cached.
 *
 * Note: This is not standard TanStack Query usage (normally you'd use useQuery/useQueries).
 * We use queryClient manually because we need bulk fetching (1 API call for N entities)
 * rather than N individual queries. Using TanStack as a cache layer is fine for this use case.
 *
 * @param entities - Array of entity references to fetch properties for
 * @param propertyDefinitionIds - Property definition IDs to fetch (required for cache correctness)
 */
export async function fetchBulkEntityProperties(
  entities: EntityReference[],
  propertyDefinitionIds: string[]
): Promise<Map<string, Property[]>> {
  if (entities.length === 0) {
    return new Map();
  }

  const result = new Map<string, Property[]>();
  const entitiesToFetch: EntityReference[] = [];

  // Check cache for each entity
  for (const entity of entities) {
    const queryKey = propertyQueryKeys.entity(
      entity.entity_type,
      entity.entity_id,
      propertyDefinitionIds
    );
    const cached = queryClient.getQueryData<Property[]>(queryKey);

    if (cached) {
      result.set(entity.entity_id, cached);
    } else {
      entitiesToFetch.push(entity);
    }
  }

  // Fetch only uncached entities
  if (entitiesToFetch.length > 0) {
    const fetchResult = await propertiesServiceClient.getBulkEntityProperties({
      body: { entities: entitiesToFetch, property_ids: propertyDefinitionIds },
    });

    if (isErr(fetchResult)) {
      console.error(
        'api.properties.fetchBulkEntityProperties:',
        fetchResult,
        ERROR_MESSAGES.PROPERTY_FETCH
      );
      // Return what we have from cache, don't throw
      return result;
    }

    const [, data] = fetchResult;

    // Update cache and result for each fetched entity
    for (const [entityId, response] of Object.entries(data)) {
      const properties = response.properties.map(entityPropertyFromApi);
      const entity = entitiesToFetch.find((e) => e.entity_id === entityId);

      if (entity) {
        const queryKey = propertyQueryKeys.entity(
          entity.entity_type,
          entity.entity_id,
          propertyDefinitionIds
        );
        queryClient.setQueryData(queryKey, properties);
      }

      result.set(entityId, properties);
    }
  }

  return result;
}
