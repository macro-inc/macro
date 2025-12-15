import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, Result } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';
import { entityPropertyFromApi } from './converters';

/**
 * Fetch all properties for an entity
 *
 * @param entityId - The ID of the entity to fetch properties for
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param includeMetadata - Whether to include metadata properties
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
 * Fetch properties for multiple entities in bulk
 *
 * @param entities - Array of entity references to fetch properties for
 * @param propertyIds - Optional array of property definition IDs to filter by
 */
export async function fetchBulkEntityProperties(
  entities: EntityReference[],
  propertyIds?: string[]
): Promise<Result<Map<string, Property[]>>> {
  if (entities.length === 0) {
    return { ok: true, value: new Map() };
  }

  try {
    const result = await propertiesServiceClient.getBulkEntityProperties({
      body: { entities, property_ids: propertyIds },
    });

    if (isErr(result)) {
      console.error(
        'api.properties.fetchBulkEntityProperties:',
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
    const propertiesMap = new Map<string, Property[]>();

    for (const [entityId, response] of Object.entries(data)) {
      const properties = response.properties.map(entityPropertyFromApi);
      propertiesMap.set(entityId, properties);
    }

    return { ok: true, value: propertiesMap };
  } catch (error) {
    console.error(
      'api.properties.fetchBulkEntityProperties:',
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
