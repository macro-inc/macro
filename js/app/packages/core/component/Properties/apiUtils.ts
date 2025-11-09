import { toast } from '@core/component/Toast/Toast';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  addPropertyToEntity as apiAddPropertyToEntity,
  deleteEntityProperty as apiDeleteEntityProperty,
  savePropertyValue as apiSavePropertyValue,
} from './api';
import type { Property, PropertyApiValues } from './types';
import { ErrorHandler } from './utils/errorHandling';

/**
 * Shared utility for saving property values with consistent error handling
 *
 * @param entityId - The ID of the block/entity
 * @param property - The property to save
 * @param apiValues - The values to save
 * @param entityType - The type of entity
 */
export async function savePropertyValue(
  entityId: string,
  property: Property,
  apiValues: PropertyApiValues,
  entityType: EntityType
): Promise<boolean> {
  const result = await apiSavePropertyValue(
    entityId,
    entityType,
    property,
    apiValues
  );

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.savePropertyValue',
      'Failed to save property value'
    );
    toast.failure('Failed to save property value');
    return false;
  }

  return true;
}

/**
 * Shared utility for removing entity properties with consistent error handling
 *
 * @param entityPropertyId - The ID of the entity property to delete
 */
export async function removeEntityProperty(
  entityPropertyId: string
): Promise<boolean> {
  const result = await apiDeleteEntityProperty(entityPropertyId);

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.removeEntityProperty',
      'Failed to delete property'
    );
    toast.failure('Failed to delete property');
    return false;
  }

  return true;
}

/**
 * Shared utility for adding properties to entities with consistent error handling
 *
 * @param entityId - The ID of the block/entity
 * @param propertyDefinitionId - The ID of the property definition to add
 * @param entityType - The type of entity
 */
export async function addEntityProperty(
  entityId: string,
  propertyDefinitionId: string,
  entityType: EntityType
): Promise<boolean> {
  const result = await apiAddPropertyToEntity(
    entityId,
    entityType,
    propertyDefinitionId
  );

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.addEntityProperty',
      'Failed to add property'
    );
    toast.failure(result.error.message || 'Failed to add property');
    return false;
  }

  return true;
}
