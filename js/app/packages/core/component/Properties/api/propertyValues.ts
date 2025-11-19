import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, PropertyApiValues, Result } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';
import { propertyValueToApi } from './converters';

/**
 * Save an entity property value
 *
 * @param entityId - The ID of the entity
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param property - The property to save
 * @param apiValues - The values to save
 */
export async function saveEntityProperty(
  entityId: string,
  entityType: EntityType,
  property: Property,
  apiValues: PropertyApiValues
): Promise<Result<void>> {
  try {
    const propertyValue = propertyValueToApi(apiValues, property.isMultiSelect);

    const result = await propertiesServiceClient.setEntityProperty({
      entity_type: entityType,
      entity_id: entityId,
      property_id: property.propertyDefinitionId,
      body: {
        value: propertyValue,
      },
    });

    if (isErr(result)) {
      console.error(
        'api.propertyValues.saveEntityProperty:',
        result,
        ERROR_MESSAGES.PROPERTY_SAVE
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: ERROR_MESSAGES.PROPERTY_SAVE,
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    console.error(
      'api.propertyValues.saveEntityProperty:',
      error,
      ERROR_MESSAGES.PROPERTY_SAVE
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
 * Delete a property from an entity
 */
export async function deleteEntityProperty(
  entityPropertyId: string
): Promise<Result<void>> {
  try {
    const result = await propertiesServiceClient.deleteEntityProperty({
      entity_property_id: entityPropertyId,
    });

    if (isErr(result)) {
      console.error(
        'api.propertyValues.deleteEntityProperty:',
        result,
        ERROR_MESSAGES.PROPERTY_DELETE
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: ERROR_MESSAGES.PROPERTY_DELETE,
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    console.error(
      'api.propertyValues.deleteEntityProperty:',
      error,
      ERROR_MESSAGES.PROPERTY_DELETE
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
 * Add an entity property without an initial value
 *
 * The backend supports attaching properties without values. Users can set the value later.
 * This is simpler and works for all property types (string, number, select, entity, etc.)
 *
 * @param entityId - The ID of the entity
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param propertyDefinitionId - The ID of the property definition to add
 */
export async function addEntityProperty(
  entityId: string,
  entityType: EntityType,
  propertyDefinitionId: string
): Promise<Result<void>> {
  try {
    const result = await propertiesServiceClient.setEntityProperty({
      entity_type: entityType,
      entity_id: entityId,
      property_id: propertyDefinitionId,
      body: {
        value: null,
      },
    });

    if (isErr(result)) {
      console.error(
        'api.propertyValues.addEntityProperty:',
        result,
        ERROR_MESSAGES.PROPERTY_ADD
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: ERROR_MESSAGES.PROPERTY_ADD,
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    console.error(
      'api.propertyValues.addEntityProperty:',
      error,
      ERROR_MESSAGES.PROPERTY_ADD
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
