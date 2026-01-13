import { type Accessor, createSignal, type Setter } from 'solid-js';
import { NUMBER_DECIMAL_PLACES } from '../constants';
import { usePropertiesContext } from '../context/PropertiesContext';
import type { Property, PropertyApiValues } from '../types';
import { formatPropertyValue } from '../utils';

/**
 * Hook for inline editing of string and number properties
 *
 * @param property - The property to edit
 * @param entityType - The type of entity
 * @param onSaved - Callback when save succeeds
 */
export function useInlineEditor(
  property: Property,
  onSaved?: () => void
): {
  isEditing: Accessor<boolean>;
  inputValue: Accessor<string>;
  setInputValue: Setter<string>;
  isSaving: Accessor<boolean>;
  startEdit: () => void;
  cancelEdit: () => void;
  save: () => Promise<void>;
} {
  const { saveHandler } = usePropertiesContext();
  const [isEditing, setIsEditing] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);

  const getCurrentRawValue = () => {
    const val = property.value;
    if (val == null) return '';

    // This hook works with string and number properties
    // For these types, val is a single value, not an array
    return formatPropertyValue(property, val as string | number);
  };

  const startEdit = () => {
    setInputValue(getCurrentRawValue());
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setInputValue('');
  };

  const save = async () => {
    if (isSaving()) return;

    const trimmedValue = inputValue().trim();
    const currentRawValue = getCurrentRawValue();

    // No change, just cancel
    if (trimmedValue === currentRawValue) {
      cancelEdit();
      return;
    }

    setIsSaving(true);

    try {
      let apiValues: PropertyApiValues;

      if (property.valueType === 'STRING') {
        apiValues = {
          valueType: 'STRING',
          value: trimmedValue || null,
        };
      } else if (property.valueType === 'NUMBER') {
        const numValue = parseFloat(trimmedValue);
        apiValues = {
          valueType: 'NUMBER',
          value: !Number.isNaN(numValue)
            ? parseFloat(numValue.toFixed(NUMBER_DECIMAL_PLACES))
            : null,
        };
      } else {
        throw new Error(`Unsupported property type: ${property.valueType}`);
      }

      await saveHandler.saveProperty(property, apiValues);
      setIsEditing(false);
      onSaved?.();
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isEditing,
    inputValue,
    setInputValue,
    isSaving,
    startEdit,
    cancelEdit,
    save,
  };
}
