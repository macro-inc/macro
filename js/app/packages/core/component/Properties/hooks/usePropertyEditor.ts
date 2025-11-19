import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import { createSignal } from 'solid-js';
import type { Property, PropertyOption } from '../types';
import { ERROR_MESSAGES, ErrorHandler } from '../utils/errorHandling';

export interface PropertyEditorState {
  options: PropertyOption[];
  selectedOptions: Set<string>;
  isLoading: boolean;
  error: string | null;
  hasChanges: boolean;
}

/**
 * Hook for managing property value editing in modals
 * Handles option fetching, selection state, and option creation
 */
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
