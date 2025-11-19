import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
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
