import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { fireAndForget } from '@core/util/fireAndForget';
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

/** The date being picked, saved as soon as one is chosen. */
function createDateEditorState() {
  const ctx = useProperty();
  const property = ctx.property() as DateProperty;

  const [selectedDate, setSelectedDate] = createSignal<Date | null>(
    property.value != null ? new Date(property.value) : null
  );

  const commit = async (date: Date | null) => {
    setSelectedDate(date);
    try {
      await ctx.onSave?.(property, { valueType: 'DATE', value: date });
    } catch {
      // mutation onError owns toast
    }
  };

  return {
    property,
    selectedDate,
    select: (date: Date | null) => {
      fireAndForget(commit(date), 'property-editor');
    },
  };
}

function DateEditorBody() {
  const ctx = useProperty();
  const state = createDateEditorState();

  return (
    <EditorPopover>
      <PropertyDateSelector
        property={state.property}
        selectedDate={state.selectedDate()}
        onSelectDate={state.select}
        onClose={() => ctx.closeEditor()}
      />
    </EditorPopover>
  );
}

/**
 * The date picker in a `PickerSheet` stacked over a touch sheet, with room for
 * its calendar above the keyboard. A pick applies at once and closes it, so
 * Done only closes.
 */
export function DateSheetEditor() {
  const ctx = useProperty();
  return (
    <Show when={isDateProperty(ctx.property())}>
      <PickerSheet.Root open={ctx.editorOpen()} onCancel={ctx.closeEditor}>
        <DateSheetBody />
      </PickerSheet.Root>
    </Show>
  );
}

function DateSheetBody() {
  const ctx = useProperty();
  const state = createDateEditorState();
  return (
    <>
      <PickerSheet.Header
        title={state.property.displayName}
        onDone={ctx.closeEditor}
      />
      <PickerSheet.Body>
        <PropertyDateSelector
          property={state.property}
          selectedDate={state.selectedDate()}
          onSelectDate={state.select}
          onClose={ctx.closeEditor}
          fillHeight
        />
      </PickerSheet.Body>
    </>
  );
}
