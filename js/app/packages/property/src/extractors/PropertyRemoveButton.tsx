import DeleteIcon from '@phosphor/x.svg';
import { cn } from '@ui';
import { createSignal } from 'solid-js';
import { useProperty } from '../core/context';
import type { Property } from '../types';
import { hasValue, toPropertyApiValue } from '../utils';

type Props = {
  /**
   * Optional specific value to remove (multi-value properties). If omitted,
   * clears the entire property.
   */
  valueToRemove?: string;
  class?: string;
  disabled?: boolean;
};

/**
 * Small X button that clears a property value (or removes one item from a
 * multi-value property). Disabled when read-only or already saving.
 *
 * Must be inside <Property.Root>.
 */
export function PropertyRemoveButton(props: Props) {
  const ctx = useProperty();
  const [isSaving, setIsSaving] = createSignal(false);

  const isReadOnly = () =>
    !ctx.canEdit() || ctx.property().isMetadata || !hasValue(ctx.property());

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly() || isSaving() || props.disabled) return;
    const property = ctx.property();
    const save = ctx.onSave;
    if (!save) return;
    setIsSaving(true);
    try {
      const next = nextValue(property, props.valueToRemove);
      if (next) await save(property, next);
      ctx.onRefresh?.();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSaving() || props.disabled || isReadOnly()}
      class={cn(
        'size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink rounded-sm',
        props.class
      )}
    >
      <DeleteIcon class="size-3" />
    </button>
  );
}

function nextValue(property: Property, removeValue?: string) {
  if (
    removeValue !== undefined &&
    (property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER' ||
      property.valueType === 'LINK')
  ) {
    const remaining = (property.value ?? []).filter((v) => v !== removeValue);
    return {
      valueType: property.valueType,
      values: remaining.length > 0 ? remaining : null,
    } as ReturnType<typeof toPropertyApiValue>;
  }
  if (removeValue !== undefined && property.valueType === 'ENTITY') {
    const remaining = (property.value ?? []).filter(
      (ref) => ref.entity_id !== removeValue
    );
    return {
      valueType: 'ENTITY' as const,
      refs: remaining.length > 0 ? remaining : null,
    };
  }
  return toPropertyApiValue(property, null);
}
