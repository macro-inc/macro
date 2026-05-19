import { type Accessor, createMemo, createSignal } from 'solid-js';
import { useProperty } from '../../core/context';

/**
 * Boolean toggle editor — instant save, no editing mode. Treats null as false
 * for the initial click (sets to true). Subsequent clicks invert.
 */
export function useBooleanEditor(): {
  value: Accessor<boolean | null>;
  isSaving: Accessor<boolean>;
  toggle: () => Promise<void>;
} {
  const ctx = useProperty();
  const [isSaving, setIsSaving] = createSignal(false);

  const value = createMemo(() => {
    const p = ctx.property();
    if (p.valueType !== 'BOOLEAN') return null;
    return p.value as boolean | null;
  });

  const toggle = async () => {
    if (isSaving()) return;
    const property = ctx.property();
    if (property.valueType !== 'BOOLEAN') return;
    if (!ctx.canEdit() || property.isMetadata) return;

    setIsSaving(true);
    try {
      const current = property.value as boolean | null;
      const next = current === null ? true : !current;
      await ctx.onSave?.(property, { valueType: 'BOOLEAN', value: next });
      ctx.onRefresh?.();
    } catch {
      // onSave callers own error UX.
    } finally {
      setIsSaving(false);
    }
  };

  return { value, isSaving, toggle };
}
