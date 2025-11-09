import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, Result } from '../types';
import { ErrorHandler } from '../utils/errorHandling';
import { fromApiFormat } from './converters';

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
      ErrorHandler.handleApiError(
        result,
        'api.properties.fetchEntityProperties',
        'Failed to load properties'
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to load properties',
        },
      };
    }

    const [, data] = result;
    const properties = data.properties.map(fromApiFormat);

    return { ok: true, value: properties };
  } catch (error) {
    ErrorHandler.handleApiError(
      error,
      'api.properties.fetchEntityProperties',
      'Failed to load properties'
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
