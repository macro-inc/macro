import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, PropertyApiValues, Result } from '../types';
import { ErrorHandler } from '../utils/errorHandling';
import { propertyValueToApi } from './converters';

/**
 * Save a property value
 *
 * @param entityId - The ID of the entity
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param property - The property to save
 * @param apiValues - The values to save
 */
export async function savePropertyValue(
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
      ErrorHandler.handleApiError(
        result,
        'api.propertyValues.savePropertyValue',
        'Failed to save property value'
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to save property value',
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    ErrorHandler.handleApiError(
      error,
      'api.propertyValues.savePropertyValue',
      'Failed to save property value'
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
      ErrorHandler.handleApiError(
        result,
        'api.propertyValues.deleteEntityProperty',
        'Failed to delete property'
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to delete property',
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    ErrorHandler.handleApiError(
      error,
      'api.propertyValues.deleteEntityProperty',
      'Failed to delete property'
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
 * Add a property to an entity without an initial value
 *
 * The backend supports attaching properties without values. Users can set the value later.
 * This is simpler and works for all property types (string, number, select, entity, etc.)
 *
 * @param entityId - The ID of the entity
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param propertyDefinitionId - The ID of the property definition to add
 */
export async function addPropertyToEntity(
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
      ErrorHandler.handleApiError(
        result,
        'api.propertyValues.addPropertyToEntity',
        'Failed to add property'
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'Failed to add property',
        },
      };
    }

    return { ok: true, value: undefined };
  } catch (error) {
    ErrorHandler.handleApiError(
      error,
      'api.propertyValues.addPropertyToEntity',
      'Failed to add property'
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
