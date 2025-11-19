import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import { createMemo, createSignal } from 'solid-js';
import type { PropertyDefinitionFlat } from '../types';
import { ERROR_MESSAGES } from '../utils/errorHandling';

export interface PropertySelectionState {
  availableProperties: PropertyDefinitionFlat[];
  selectedPropertyIds: Set<string>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for managing property selection in the "Add Properties" modal
 * Handles fetching available properties, filtering, and tracking selections
 */
export function usePropertySelection(
  existingPropertyIds: string[],
  searchQuery?: () => string
) {
  const [state, setState] = createSignal<PropertySelectionState>({
    availableProperties: [],
    selectedPropertyIds: new Set(),
    isLoading: false,
    error: null,
  });

  // Memoize Set creation to avoid recreation on every search keystroke
  const existingPropertyIdsSet = createMemo(() => new Set(existingPropertyIds));

  const filteredProperties = createMemo(() => {
    const currentState = state();
    const query = searchQuery ? searchQuery().toLowerCase().trim() : '';
    const existingIds = existingPropertyIdsSet();

    // First filter out existing properties (reactive to existingPropertyIds changes)
    const availableProperties = currentState.availableProperties.filter(
      (property) => property && property.id && !existingIds.has(property.id)
    );

    // Then apply search filter
    if (!query) return availableProperties;

    return availableProperties.filter((property) => {
      const name = property.display_name.toLowerCase();
      const dataType = property.data_type;
      let typeDisplay = dataType;

      if (dataType === 'ENTITY' && property.specific_entity_type) {
        typeDisplay += ` (${property.specific_entity_type})`;
      }

      return name.includes(query) || typeDisplay.toLowerCase().includes(query);
    });
  });

  const fetchAvailableProperties = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await propertiesServiceClient.listProperties({
        scope: 'all',
        include_options: true,
      });

      if (isErr(result)) {
        setState((prev) => ({
          ...prev,
          error: ERROR_MESSAGES.FETCH_PROPERTIES,
          isLoading: false,
        }));
        return;
      }

      const [, data] = result;
      const availableProperties = Array.isArray(data) ? data : [];

      // Transform the nested structure to flat structure
      const transformedProperties = availableProperties.map((item) => ({
        ...item.definition,
        propertyOptions: item.property_options || [],
      }));

      setState((prev) => ({
        ...prev,
        availableProperties: transformedProperties,
        isLoading: false,
      }));
    } catch (_apiError) {
      setState((prev) => ({
        ...prev,
        error: ERROR_MESSAGES.FETCH_PROPERTIES,
        isLoading: false,
      }));
    }
  };

  const togglePropertySelection = (propertyId: string) => {
    setState((prev) => {
      const newSelected = new Set(prev.selectedPropertyIds);

      if (newSelected.has(propertyId)) {
        newSelected.delete(propertyId);
      } else {
        newSelected.add(propertyId);
      }

      return { ...prev, selectedPropertyIds: newSelected };
    });
  };

  const clearSelection = () => {
    setState((prev) => ({ ...prev, selectedPropertyIds: new Set() }));
  };

  return {
    state,
    filteredProperties,
    fetchAvailableProperties,
    togglePropertySelection,
    clearSelection,
  };
}
