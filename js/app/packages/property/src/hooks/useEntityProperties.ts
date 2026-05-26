import {
  useAddEntityPropertyMutation,
  useDeleteEntityPropertyMutation,
  useEntityPropertiesQuery,
} from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Accessor } from 'solid-js';
import type { Property } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';

/**
 * Main hook for fetching and managing properties for an entity
 *
 * This hook focuses purely on data management and returns structured results.
 * UI feedback (toasts, notifications) is handled by mutations.
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
  addProperty: (propertyDefinitionId: string) => Promise<void>;
  removeProperty: (propertyId: string) => Promise<void>;
} {
  const query = useEntityPropertiesQuery(
    () => entityType,
    () => entityId,
    includeMetadata
  );

  const addMutation = useAddEntityPropertyMutation();
  const deleteMutation = useDeleteEntityPropertyMutation();

  return {
    properties: () => query.data ?? [],
    isLoading: () => query.isLoading,
    error: () => (query.error ? ERROR_MESSAGES.PROPERTY_FETCH : null),
    refetch: () => void query.refetch(),
    addProperty: (propertyDefinitionId: string) =>
      addMutation.mutateAsync({ entityId, entityType, propertyDefinitionId }),
    removeProperty: (propertyId: string) =>
      deleteMutation.mutateAsync({
        entityPropertyId: propertyId,
        entityType,
        entityId,
      }),
  };
}
