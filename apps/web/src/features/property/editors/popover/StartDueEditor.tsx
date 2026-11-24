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

const ENDS: DateField[] = ['start', 'due'];

/** Whether `end` of `dates` holds a time of day. */
function hasTimeAt(dates: StartDue, end: DateField): boolean {
  return !!dates.timed && dates[end] != null && dates.wholeDay !== end;
}

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
      {/* The two fields and the footer need more room than a single date's
          calendar. Capped at the room the popper has, so adding times near the
          screen's edge scrolls the time list instead of pushing the footer off. */}
      <EditorPopover class="max-h-[min(28rem,var(--kb-popper-content-available-height,28rem))] *:min-h-0">
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
      ...(hasTimeAt(next, field) ? { hasTime: true } : {}),
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
  // What the server holds once `field` of `next` is saved: each end keeps
  // the precision it was last saved with.
  const savedWith = (field: DateField, next: StartDue): StartDue => {
    const ends = { start: saved.start, due: saved.due, [field]: next[field] };
    const withTime = {
      start: hasTimeAt(field === 'start' ? next : saved, 'start'),
      due: hasTimeAt(field === 'due' ? next : saved, 'due'),
    };
    const timed = withTime.start || withTime.due;
    return {
      ...ends,
      timed,
      wholeDay: timed
        ? ENDS.find((end) => ends[end] && !withTime[end])
        : undefined,
    };
  };

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
        saved = savedWith(field, next);
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
        // Only a restored end takes back its saved precision; a newer edit
        // of the other end keeps its own.
        wholeDay: ENDS.find((end) =>
          restore.includes(end)
            ? saved.wholeDay === end
            : shown.wholeDay === end
        ),
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
        // The picks say which end is a whole day: a picked time gives an end
        // one, and Change day keeps an end without a time a whole day.
        setDates(next);
        fireAndForget(enqueue(next, changed), 'property-editor');
      }}
      onClose={() => ctx.closeEditor()}
      fillHeight={props.fillHeight}
    />
  );
}
