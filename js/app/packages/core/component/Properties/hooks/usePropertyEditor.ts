import type { AddPropertyOptionAsyncMutation } from '@queries/properties/options';
import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';
import type { Property, PropertyOption } from '../types';

type LocalState = {
  selectedOptions: Set<string>;
  hasChanges: boolean;
};

export interface PropertyEditorReturn {
  selectedOptions: Accessor<Set<string>>;
  hasChanges: Accessor<boolean>;
  initializeSelectedOptions: () => void;
  toggleOption: (optionValue: string) => void;
  addOption: (value: string) => Promise<void>;
}

/**
 * Hook for managing property value editing in modals
 * Handles option fetching, selection state, and option creation
 *
 * Note: Uses manual fetch instead of TanStack Query to avoid
 * triggering Suspense boundaries when the modal opens.
 */
export function usePropertyEditor(
  property: Property,
  propertyOptions: Accessor<PropertyOption[]>,
  addPropertyOption: AddPropertyOptionAsyncMutation
): PropertyEditorReturn {
  const [localState, setLocalState] = createSignal<LocalState>({
    selectedOptions: new Set(),
    hasChanges: false,
  });

  const initializeSelectedOptions = () => {
    const selected = new Set<string>();

    // For select types, property.value is already an array (or null)
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

    setLocalState((prev) => ({ ...prev, selectedOptions: selected }));
  };

  const toggleOption = (optionValue: string) => {
    setLocalState((prev) => {
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
    const currentOptions = propertyOptions();
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

    const newOption = await addPropertyOption({
      propertyDefinitionId: property.propertyDefinitionId,
      body: optionBody,
    });

    // Select the newly created option
    const newSelected = new Set(localState().selectedOptions);
    const optionId = newOption.id;

    if (property.isMultiSelect) {
      newSelected.add(optionId);
    } else {
      newSelected.clear();
      newSelected.add(optionId);
    }

    setLocalState((prev) => ({
      ...prev,
      selectedOptions: newSelected,
      hasChanges: true,
    }));
  };

  return {
    selectedOptions: () => localState().selectedOptions,
    hasChanges: () => localState().hasChanges,
    initializeSelectedOptions,
    toggleOption,
    addOption,
  };
}
