import { createSignal, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { DateProperty } from '../../types';
import { isDateProperty } from '../../utils';
import { PropertyDateSelector } from '../selectors/PropertyDateSelector';
import { EditorPopover } from './EditorPopover';

/**
 * Date picker popover. Local selectedDate state initialised from current
 * value; save happens on selection (PropertyDateSelector calls onSelectDate
 * then closes via onClose).
 */
export function DateEditor() {
  const ctx = useProperty();

  return (
    <Show when={ctx.editorOpen() && isDateProperty(ctx.property())}>
      <DateEditorBody />
    </Show>
  );
}

function DateEditorBody() {
  const ctx = useProperty();
  const property = ctx.property() as DateProperty;

  const [selectedDate, setSelectedDate] = createSignal<Date | null>(
    property.value != null ? new Date(property.value) : null
  );

  const commit = async (date: Date | null) => {
    setSelectedDate(date);
    try {
      await ctx.onSave?.(property, { valueType: 'DATE', value: date });
      ctx.onRefresh?.();
    } catch {
      // mutation onError owns toast
    }
  };

  return (
    <EditorPopover>
      <PropertyDateSelector
        property={property}
        selectedDate={selectedDate()}
        onSelectDate={(date) => {
          commit(date);
        }}
        onClose={() => ctx.closeEditor()}
      />
    </EditorPopover>
  );
}
