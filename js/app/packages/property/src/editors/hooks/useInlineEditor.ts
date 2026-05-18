import { type Accessor, createSignal, type Setter } from 'solid-js';
import { NUMBER_DECIMAL_PLACES } from '../../constants';
import { useProperty } from '../../core/context';
import type { PropertyApiValues } from '../../types';
import { formatPropertyValue } from '../../utils';

/**
 * Inline editing state for STRING / NUMBER properties. Saves via the
 * <Property.Root> onSave handler; surfaces dirty/saving signals for UI.
 *
 * Read-only properties (canEdit=false or isMetadata) reject startEdit.
 */
export function useInlineEditor(): {
  isEditing: Accessor<boolean>;
  inputValue: Accessor<string>;
  setInputValue: Setter<string>;
  isSaving: Accessor<boolean>;
  startEdit: () => void;
  cancelEdit: () => void;
  save: () => Promise<void>;
} {
  const ctx = useProperty();
  const [isEditing, setIsEditing] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);

  const getCurrentRawValue = () => {
    const property = ctx.property();
    const val = property.value;
    if (val == null) return '';
    return formatPropertyValue(property, val as string | number);
  };

  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;

  const startEdit = () => {
    if (isReadOnly()) return;
    setInputValue(getCurrentRawValue());
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setInputValue('');
  };

  const save = async () => {
    if (isSaving()) return;
    const property = ctx.property();
    const trimmedValue = inputValue().trim();
    const currentRawValue = getCurrentRawValue();

    if (trimmedValue === currentRawValue) {
      cancelEdit();
      return;
    }

    setIsSaving(true);
    try {
      let apiValues: PropertyApiValues;
      if (property.valueType === 'STRING') {
        apiValues = { valueType: 'STRING', value: trimmedValue || null };
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
      await ctx.onSave?.(property, apiValues);
      setIsEditing(false);
      ctx.onRefresh?.();
    } catch {
      // onSave callers (mutations) own error UX via onError toasts.
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
