import { fireAndForget } from '@core/util/fireAndForget';
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
  save: () => Promise<void>;
  handleKeyDown: (e: KeyboardEvent) => void;
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
    // Removing a canceled input can still fire blur.
    if (!isEditing() || isSaving()) return;
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
    } catch {
      // onSave callers (mutations) own error UX via onError toasts.
    } finally {
      setIsSaving(false);
    }
  };

  // Enter and Escape remove the focused field, which drops focus to the page.
  // Tabbing or clicking away already put focus where the user wanted it.
  const returnFocus = () => {
    if (document.activeElement === document.body) ctx.closeEditor();
  };

  const saveFromKeyboard = async () => {
    await save();
    if (!isEditing()) returnFocus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fireAndForget(saveFromKeyboard(), 'property-editor');
    } else if (e.key === 'Escape' && !isSaving()) {
      e.preventDefault();
      cancelEdit();
      returnFocus();
    }
  };

  return {
    isEditing,
    inputValue,
    setInputValue,
    isSaving,
    startEdit,
    save,
    handleKeyDown,
  };
}
