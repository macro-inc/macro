import { useBlockId } from '@core/block';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { savePropertyValue } from '../api';
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
  entityType: EntityType,
  onSaved?: () => void
): {
  value: Accessor<boolean | undefined>;
  isSaving: Accessor<boolean>;
  toggle: () => Promise<void>;
} {
  const blockId = useBlockId();
  const [isSaving, setIsSaving] = createSignal(false);

  const currentValue = createMemo(() => {
    return property.value as boolean | undefined;
  });

  const toggle = async () => {
    if (isSaving()) return;

    setIsSaving(true);

    try {
      const actualValue = property.value as boolean | undefined;

      // If currently unset (undefined), set to true
      // Otherwise toggle between true and false
      const newValue = actualValue === undefined ? true : !actualValue;

      const result = await savePropertyValue(blockId, entityType, property, {
        valueType: 'BOOLEAN',
        value: newValue,
      });

      if (result.ok) {
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
