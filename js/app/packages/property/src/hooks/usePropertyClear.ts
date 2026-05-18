import { createSignal } from 'solid-js';
import { useProperty } from '../core/context';
import { toPropertyApiValue } from '../utils';

/**
 * Clears a property's value (sets to null). Tracks an `isSaving` signal so
 * UI can disable affordances during the call.
 */
export function usePropertyClear() {
  const ctx = useProperty();
  const [isSaving, setIsSaving] = createSignal(false);

  const clear = async () => {
    if (isSaving()) return;
    const save = ctx.onSave;
    if (!save) return;
    const property = ctx.property();
    if (!ctx.canEdit() || property.isMetadata) return;
    setIsSaving(true);
    try {
      const next = toPropertyApiValue(property, null);
      if (next) await save(property, next);
      ctx.onRefresh?.();
    } finally {
      setIsSaving(false);
    }
  };

  return { clear, isSaving };
}
