import {
  invalidatePropertiesForEntity,
  useEntityPropertiesQuery,
} from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Accessor } from 'solid-js';
import { addEntityProperty, deleteEntityProperty } from '../api';
import type { Property } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';

/**
 * Main hook for fetching and managing properties for an entity
 *
 * This hook focuses purely on data management and returns structured results.
 * UI feedback (toasts, notifications) should be handled by consuming components.
 *
 * @param entityId - The ID of the entity to fetch properties for
 * @param entityType - The type of entity (e.g., 'document', 'channel', 'project')
 * @param includeMetadata - Whether to include metadata properties
 */
export function useEntityProperties(
  entityId: string,
  entityType: EntityType,
  includeMetadata: boolean
): {
  properties: Accessor<Property[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  refetch: () => void;
  addProperty: (
    propertyDefinitionId: string
  ) => Promise<{ success: boolean; error?: string }>;
  removeProperty: (
    propertyId: string
  ) => Promise<{ success: boolean; error?: string }>;
} {
  const query = useEntityPropertiesQuery(
    () => entityType,
    () => entityId,
    includeMetadata
  );

  const doRefetch = () => {
    invalidatePropertiesForEntity(entityType, entityId);
    void query.refetch();
  };

  const addProperty = async (
    propertyDefinitionId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const result = await addEntityProperty(
      entityId,
      entityType,
      propertyDefinitionId
    );

    if (result.ok) {
      doRefetch();
      return { success: true };
    } else {
      return { success: false, error: ERROR_MESSAGES.PROPERTY_ADD };
    }
  };

  const removeProperty = async (
    propertyId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const result = await deleteEntityProperty(propertyId);

    if (result.ok) {
      doRefetch();
      return { success: true };
    } else {
      return { success: false, error: ERROR_MESSAGES.PROPERTY_DELETE };
    }
  };

  return {
    properties: () => query.data ?? [],
    isLoading: () => query.isLoading,
    error: () => (query.error ? ERROR_MESSAGES.PROPERTY_FETCH : null),
    refetch: doRefetch,
    addProperty,
    removeProperty,
  };
}
