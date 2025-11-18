import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import { createMemo, createSignal } from 'solid-js';
import type {
  Property,
  PropertyDefinitionFlat,
  PropertyOption,
} from '../types';
import { ERROR_MESSAGES, ErrorHandler } from '../utils/errorHandling';

export interface PropertyManagementState {
  availableProperties: PropertyDefinitionFlat[];
  selectedPropertyIds: Set<string>;
  isLoading: boolean;
  error: string | null;
}

export function usePropertyModals(
  existingPropertyIds: string[],
  searchQuery?: () => string
) {
  const [state, setState] = createSignal<PropertyManagementState>({
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

export interface PropertyEditorState {
  options: PropertyOption[];
  selectedOptions: Set<string>;
  isLoading: boolean;
  error: string | null;
  hasChanges: boolean;
}

export function usePropertyEditor(property: Property) {
  const [state, setState] = createSignal<PropertyEditorState>({
    options: [],
    selectedOptions: new Set(),
    isLoading: false,
    error: null,
    hasChanges: false,
  });

  const fetchOptions = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await propertiesServiceClient.getPropertyOptions({
        definition_id: property.propertyDefinitionId,
      });

      if (isErr(result)) {
        setState((prev) => ({
          ...prev,
          error: ERROR_MESSAGES.FETCH_OPTIONS,
          isLoading: false,
        }));
        return;
      }

      const [, data] = result;
      setState((prev) => ({
        ...prev,
        options: Array.isArray(data) ? data : [],
        isLoading: false,
      }));
    } catch (_apiError) {
      setState((prev) => ({
        ...prev,
        error: ERROR_MESSAGES.FETCH_OPTIONS,
        isLoading: false,
      }));
    }
  };

  const initializeSelectedOptions = () => {
    const selected = new Set<string>();

    // For select types, property.value is already an array (or undefined)
    if (
      (property.valueType === 'SELECT_STRING' ||
        property.valueType === 'SELECT_NUMBER') &&
      Array.isArray(property.value)
    ) {
      property.value.forEach((value) => {
        selected.add(value);
      });
    }

    // For entity types, property.value is EntityReference[] with entity_id
    if (property.valueType === 'ENTITY' && Array.isArray(property.value)) {
      property.value.forEach((ref) => {
        selected.add(ref.entity_id);
      });
    }

    setState((prev) => ({ ...prev, selectedOptions: selected }));
  };

  const toggleOption = (optionValue: string) => {
    setState((prev) => {
      const newSelected = new Set(prev.selectedOptions);

      if (property.isMultiSelect) {
        if (newSelected.has(optionValue)) {
          newSelected.delete(optionValue);
        } else {
          newSelected.add(optionValue);
        }
      } else {
        newSelected.clear();
        newSelected.add(optionValue);
      }

      return {
        ...prev,
        selectedOptions: newSelected,
        hasChanges: true,
      };
    });
  };

  const addOption = async (value: string) => {
    try {
      const currentOptions = state().options;
      const nextDisplayOrder =
        currentOptions.length > 0
          ? Math.max(...currentOptions.map((opt) => opt.display_order)) + 1
          : 0;

      let optionBody:
        | {
            type: 'select_string';
            option: { value: string; display_order: number };
          }
        | {
            type: 'select_number';
            option: { value: number; display_order: number };
          };

      if (property.valueType === 'SELECT_STRING') {
        optionBody = {
          type: 'select_string',
          option: {
            value,
            display_order: nextDisplayOrder,
          },
        };
      } else if (property.valueType === 'SELECT_NUMBER') {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || !Number.isFinite(numValue)) {
          throw new Error('Invalid number value');
        }
        optionBody = {
          type: 'select_number',
          option: {
            value: numValue,
            display_order: nextDisplayOrder,
          },
        };
      } else {
        throw new Error(
          `Adding options for ${property.valueType} type is not supported`
        );
      }

      const result = await propertiesServiceClient.addPropertyOption({
        definition_id: property.propertyDefinitionId,
        body: optionBody,
      });

      if (isErr(result)) {
        throw new Error('Failed to create option');
      }

      const [, newOption] = result;

      // Type guard to ensure newOption is PropertyOption
      if (!newOption || typeof newOption !== 'object' || !('id' in newOption)) {
        throw new Error('Invalid option returned from API');
      }

      setState((prev) => ({
        ...prev,
        options: [...prev.options, newOption as PropertyOption],
      }));

      const newSelected = new Set(state().selectedOptions);

      // The API returns the option ID, which is what we need for selection
      const optionId = newOption.id;
      let valueToSelect: string = optionId;

      if (property.isMultiSelect) {
        newSelected.add(valueToSelect);
      } else {
        newSelected.clear();
        newSelected.add(valueToSelect);
      }

      setState((prev) => ({
        ...prev,
        selectedOptions: newSelected,
        hasChanges: true,
      }));
    } catch (error) {
      ErrorHandler.handleApiError(
        error,
        'usePropertyEditor.addOption',
        'Failed to add option'
      );
      throw error;
    }
  };

  return {
    state,
    fetchOptions,
    initializeSelectedOptions,
    toggleOption,
    addOption,
  };
}
