import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { DateProperty } from '../../types';
import { isDateProperty } from '../../utils';
import type { DateField, StartDue } from '../../utils/start-due';
import { StartDueSelector } from '../selectors/StartDueSelector';
import { EditorPopover } from './EditorPopover';

export type StartDueEditorProps = {
  /** Which end the pill or row that opens the picker shows. */
  field: DateField;
  /** The other end, a placeholder while it is unset. */
  other: () => DateProperty;
  /** Saves the other end, which the pill or row does not own. */
  saveOther: (property: DateProperty, value: Date | null) => Promise<unknown>;
};

/** The dates picker in a popover, opened from a Start Date or Due Date pill. */
export function StartDueEditor(props: StartDueEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen() && isDateProperty(ctx.property())}>
      <EditorPopover>
        <StartDueEditorBody {...props} />
      </EditorPopover>
    </Show>
  );
}

/**
 * The dates picker in a `PickerSheet` stacked over a touch sheet. A pick saves
 * at once, so Done only closes.
 */
export function StartDueSheetEditor(props: StartDueEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={isDateProperty(ctx.property())}>
      <PickerSheet.Root open={ctx.editorOpen()} onCancel={ctx.closeEditor}>
        <PickerSheet.Header title="Dates" onDone={ctx.closeEditor} />
        <PickerSheet.Body>
          <StartDueEditorBody {...props} fillHeight />
        </PickerSheet.Body>
      </PickerSheet.Root>
    </Show>
  );
}

function StartDueEditorBody(
  props: StartDueEditorProps & { fillHeight?: boolean }
) {
  const ctx = useProperty();
  const own = ctx.property() as DateProperty;
  const other = props.other();
  const end = (field: DateField) => (field === props.field ? own : other);
  const day = (property: DateProperty) =>
    property.value != null ? new Date(property.value) : null;

  const [dates, setDates] = createSignal<StartDue>({
    start: day(end('start')),
    due: day(end('due')),
  });

  const save = async (field: DateField, value: Date | null) => {
    if (field === props.field) {
      await ctx.onSave?.(own, { valueType: 'DATE', value });
      return;
    }
    await props.saveOther(other, value);
  };

  const commit = async (next: StartDue, changed: DateField[]) => {
    try {
      for (const field of changed) await save(field, next[field]);
    } catch {
      // mutation onError owns toast
    }
  };

  return (
    <StartDueSelector
      dates={dates()}
      field={props.field}
      names={{
        start: end('start').displayName,
        due: end('due').displayName,
      }}
      onChange={(next, changed) => {
        setDates(next);
        fireAndForget(commit(next, changed), 'property-editor');
      }}
      onClose={() => ctx.closeEditor()}
      fillHeight={props.fillHeight}
    />
  );
}
