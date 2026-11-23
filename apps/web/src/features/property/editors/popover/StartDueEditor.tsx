import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { fireAndForget } from '@core/util/fireAndForget';
import { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { DateApiValue, DateProperty } from '../../types';
import { isDateProperty } from '../../utils';
import {
  type DateField,
  type StartDue,
  startDueOf,
} from '../../utils/start-due';
import { StartDueSelector } from '../selectors/StartDueSelector';
import { EditorPopover } from './EditorPopover';

export type StartDueEditorProps = {
  /** Which end the pill or row that opens the picker shows. */
  field: DateField;
  /** The other end, a placeholder while it is unset. */
  other: () => DateProperty;
  /** Saves the other end, which the pill or row does not own. */
  saveOther: (property: DateProperty, value: DateApiValue) => Promise<unknown>;
};

/** The dates picker in a popover, opened from a Start Date or Due Date pill. */
export function StartDueEditor(props: StartDueEditorProps) {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen() && isDateProperty(ctx.property())}>
      {/* The two fields and the footer need more room than a single date's calendar. */}
      <EditorPopover class="max-h-[28rem]">
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
  const [dates, setDates] = createSignal<StartDue>(
    startDueOf(end('start'), end('due'))
  );

  const save = async (field: DateField, next: StartDue) => {
    const value: DateApiValue = {
      valueType: 'DATE',
      value: next[field],
      ...(next.timed && next[field] ? { hasTime: true } : {}),
    };
    if (field === props.field) {
      await ctx.onSave?.(own, value);
      return;
    }
    await props.saveOther(other, value);
  };

  // What the server holds, so a failed save shows the persisted ends again.
  let saved: StartDue = dates();
  // How many edits each end has had, so a failed save never undoes a newer one.
  const edits: Record<DateField, number> = { start: 0, due: 0 };
  // Saves run in the order they were made, so an older one never lands last.
  let pending: Promise<void> = Promise.resolve();

  // The server keeps a start on or before the saved due date, so a start
  // moving past that due date waits until the new due date is saved.
  const saveOrder = (next: StartDue, changed: DateField[]): DateField[] =>
    changed.includes('due') && next.start && saved.due && next.start > saved.due
      ? ['due', ...changed.filter((end) => end !== 'due')]
      : changed;

  const commit = async (
    next: StartDue,
    ends: DateField[],
    made: Record<DateField, number>
  ) => {
    const changed = saveOrder(next, ends);
    for (const [index, field] of changed.entries()) {
      const result = await ResultAsync.fromPromise(
        save(field, next),
        (error) => error
      );
      if (result.isOk()) {
        saved = { ...saved, [field]: next[field], timed: next.timed };
        continue;
      }
      // mutation onError owns toast
      const restore = changed
        .slice(index)
        .filter((end) => edits[end] === made[end]);
      setDates((shown) => ({
        start: restore.includes('start') ? saved.start : shown.start,
        due: restore.includes('due') ? saved.due : shown.due,
        timed: restore.length > 0 ? saved.timed : shown.timed,
      }));
      return;
    }
  };

  const enqueue = (next: StartDue, changed: DateField[]) => {
    for (const end of changed) edits[end] += 1;
    const made = { ...edits };
    const previous = pending;
    pending = (async () => {
      await previous;
      await commit(next, changed, made);
    })();
    return pending;
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
        fireAndForget(enqueue(next, changed), 'property-editor');
      }}
      onClose={() => ctx.closeEditor()}
      fillHeight={props.fillHeight}
    />
  );
}
