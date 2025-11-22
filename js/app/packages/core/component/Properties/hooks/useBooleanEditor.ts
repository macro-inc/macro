import { useBlockId } from '@core/block';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { saveEntityProperty } from '../api';
import type { Property } from '../types';
import { ERROR_MESSAGES, handlePropertyError } from '../utils/errorHandling';

/**
 * Hook for editing boolean properties
 *
 * @param property - The property to toggle
 * @param entityType - The type of entity
 * @param onSaved - Callback when save succeeds
 */
export function useBooleanEditor(
  property: Property & { valueType: 'BOOLEAN' },
  entityType: EntityType,
  onSaved?: () => void
): {
  value: Accessor<boolean | null>;
  isSaving: Accessor<boolean>;
  toggle: () => Promise<void>;
} {
  const blockId = useBlockId();
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

      const result = await saveEntityProperty(blockId, entityType, property, {
        valueType: 'BOOLEAN',
        value: newValue,
      });

      if (
        handlePropertyError(
          result,
          ERROR_MESSAGES.PROPERTY_SAVE,
          'useBooleanEditor.toggle'
        )
      ) {
        onSaved?.();
      }
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
