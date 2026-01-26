import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { PropertySaveHandler } from '../context/PropertiesContext';
import type { Property } from '../types';

/**
 * Hook for editing boolean properties
 *
 * @param property - The property to toggle
 * @param entityType - The type of entity
 * @param onSaved - Callback when save succeeds
 */
export function useBooleanEditor(
  property: Property & { valueType: 'BOOLEAN' },
  saveHandler: PropertySaveHandler,
  onSaved?: () => void
): {
  value: Accessor<boolean | null>;
  isSaving: Accessor<boolean>;
  toggle: () => Promise<void>;
} {
  const [isSaving, setIsSaving] = createSignal(false);

  const currentValue = createMemo(() => {
    return property.value as boolean | null;
  });

  const toggle = async () => {
    if (isSaving()) return;

    setIsSaving(true);

    try {
      const actualValue = property.value as boolean | null;

      // If currently unset (null), set to true
      // Otherwise toggle between true and false
      const newValue = actualValue === null ? true : !actualValue;

      await saveHandler.saveProperty(property, {
        valueType: 'BOOLEAN',
        value: newValue,
      });
      onSaved?.();
    } catch {
      // Error toast is shown by mutation's onError callback
    } finally {
      setIsSaving(false);
    }
  };

  return {
    value: currentValue,
    isSaving,
    toggle,
  };
}
