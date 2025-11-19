import { toast } from '@core/component/Toast/Toast';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Property, PropertyApiValues } from '../types';
import { ErrorHandler } from '../utils/errorHandling';
import {
  addEntityProperty as apiAddEntityProperty,
  deleteEntityProperty as apiDeleteEntityProperty,
  saveEntityProperty as apiSaveEntityProperty,
} from './index';

/**
 * Shared utility for saving entity property values with consistent error handling and toast notifications
 *
 * @param entityId - The ID of the block/entity
 * @param property - The property to save
 * @param apiValues - The values to save
 * @param entityType - The type of entity
 */
export async function saveEntityPropertyWithToast(
  entityId: string,
  property: Property,
  apiValues: PropertyApiValues,
  entityType: EntityType
): Promise<boolean> {
  const result = await apiSaveEntityProperty(
    entityId,
    entityType,
    property,
    apiValues
  );

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.saveEntityPropertyWithToast',
      'Failed to save property value'
    );
    toast.failure('Failed to save property value');
    return false;
  }

  return true;
}

/**
 * Shared utility for deleting entity properties with consistent error handling and toast notifications
 *
 * @param entityPropertyId - The ID of the entity property to delete
 */
export async function deleteEntityPropertyWithToast(
  entityPropertyId: string
): Promise<boolean> {
  const result = await apiDeleteEntityProperty(entityPropertyId);

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.deleteEntityPropertyWithToast',
      'Failed to delete property'
    );
    toast.failure('Failed to delete property');
    return false;
  }

  return true;
}

/**
 * Shared utility for adding entity properties with consistent error handling and toast notifications
 *
 * @param entityId - The ID of the block/entity
 * @param propertyDefinitionId - The ID of the property definition to add
 * @param entityType - The type of entity
 */
export async function addEntityPropertyWithToast(
  entityId: string,
  propertyDefinitionId: string,
  entityType: EntityType
): Promise<boolean> {
  const result = await apiAddEntityProperty(
    entityId,
    entityType,
    propertyDefinitionId
  );

  if (!result.ok) {
    ErrorHandler.handleApiError(
      result.error,
      'apiUtils.addEntityPropertyWithToast',
      'Failed to add property'
    );
    toast.failure(result.error.message || 'Failed to add property');
    return false;
  }

  return true;
}
