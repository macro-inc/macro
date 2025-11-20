import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createSignal, onMount } from 'solid-js';
import {
  addEntityProperty,
  deleteEntityProperty,
  fetchEntityProperties,
} from '../api';
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
  const [properties, setProperties] = createSignal<Property[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleFetchError = (errorMessage: string) => {
    setError(errorMessage);
    // Return error for component to handle UI feedback
    return { success: false, error: errorMessage };
  };

  const fetch = async () => {
    // Don't show loading spinner if we already have properties (background refresh)
    if (properties().length === 0) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await fetchEntityProperties(
        entityId,
        entityType,
        includeMetadata
      );

      if (result.ok) {
        setProperties(result.value);
      } else {
        return handleFetchError(ERROR_MESSAGES.PROPERTY_FETCH);
      }
    } catch (_err) {
      return handleFetchError(ERROR_MESSAGES.PROPERTY_FETCH);
    } finally {
      setIsLoading(false);
    }

    return { success: true };
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
      await fetch(); // Refetch to get updated list
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
      await fetch(); // Refetch to get updated list
      return { success: true };
    } else {
      return { success: false, error: ERROR_MESSAGES.PROPERTY_DELETE };
    }
  };

  const refetch = () => {
    fetch();
  };

  onMount(() => {
    fetch();
  });

  return {
    properties,
    isLoading,
    error,
    refetch,
    addProperty,
    removeProperty,
  };
}
