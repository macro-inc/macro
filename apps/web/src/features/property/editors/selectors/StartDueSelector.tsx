import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import { cn } from '@ui';
import { startOfDay } from 'date-fns';
import { createSignal, Show } from 'solid-js';
import {
  type DateField,
  pickDay,
  type StartDue,
  startDueDays,
} from '../../utils/start-due';
import { PropertyDateSelector } from './PropertyDateSelector';

type StartDueSelectorProps = {
  dates: StartDue;
  /** The end the picker sets first. */
  field: DateField;
  /** The two properties' names, for the search field's placeholder. */
  names: Record<DateField, string>;
  /** Saves the ends in `changed`; `dates` holds both ends after the change. */
  onChange: (dates: StartDue, changed: DateField[]) => void;
  onClose?: () => void;
  fillHeight?: boolean;
};

const FIELD_DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/**
 * The dates picker of a task or project: a Start and a Due field over the
 * date suggestions, which set the field that is active, and a calendar that
 * picks the range. A suggestion closes the picker, as a due date's does. In
 * the calendar a start moves on to the due date and a due date closes it.
 */
export function StartDueSelector(props: StartDueSelectorProps) {
  const [field, setField] = createSignal(props.field);
  const keepSearchFocus = (event: Event) => event.preventDefault();

  // A start is kept at the start of its day, so a start and a due date on
  // the same day never read as a start after the due date. A due date keeps
  // the moment the suggestion gives it, as it always has.
  const select = (date: Date | null) => {
    if (!date) {
      props.onChange({ ...props.dates, [field()]: null }, [field()]);
      return;
    }
    const day = field() === 'start' ? startOfDay(date) : date;
    const picked = pickDay(props.dates, field(), day);
    props.onChange(picked.dates, [picked.changed]);
  };

  const pickFromCalendar = (day: Date) => {
    const active = field();
    const picked = pickDay(props.dates, active, day);
    props.onChange(picked.dates, [picked.changed]);
    if (active === 'due' && picked.changed === 'due') {
      props.onClose?.();
      return;
    }
    if (active === 'start' && picked.changed === 'start') setField('due');
  };

  const fieldButton = (end: DateField, label: string) => {
    const value = () => props.dates[end];
    return (
      <button
        type="button"
        class={cn(
          'flex min-w-0 flex-col items-start rounded-md border px-2 py-1 text-left touch:min-h-12',
          field() === end
            ? 'border-ink'
            : 'border-edge-muted not-touch:hover:bg-hover'
        )}
        aria-pressed={field() === end}
        onClick={() => setField(end)}
      >
        <span class="text-xs text-ink-muted">{label}</span>
        <span class={cn('truncate', !value() && 'text-ink-muted')}>
          {value() ? FIELD_DAY_FORMAT.format(value()!) : 'None'}
        </span>
      </button>
    );
  };

  const clear = (ends: DateField[]) => {
    const next = { ...props.dates };
    for (const end of ends) next[end] = null;
    props.onChange(next, ends);
  };

  const days = () => {
    const { start, due } = props.dates;
    return start && due ? startDueDays(start, due) : undefined;
  };

  return (
    <PropertyDateSelector
      property={{ displayName: props.names[field()] }}
      selectedDate={props.dates[field()]}
      onSelectDate={select}
      onClose={props.onClose}
      fillHeight={props.fillHeight}
      header={
        <div
          class="grid shrink-0 grid-cols-2 gap-1.5 border-b border-edge-muted p-1.5"
          onPointerDown={keepSearchFocus}
          onMouseDown={keepSearchFocus}
        >
          {fieldButton('start', 'Start')}
          {fieldButton('due', 'Due')}
        </div>
      }
      calendar={
        // Remounted per active end so the calendar opens on that end's month.
        <Show when={field()} keyed>
          {(active) => (
            <DatePickerUI
              value={props.dates[active] ?? props.dates.start ?? new Date()}
              range={{ start: props.dates.start, end: props.dates.due }}
              onChange={pickFromCalendar}
            />
          )}
        </Show>
      }
      footer={
        <Show when={props.dates.start}>
          <div
            class="flex shrink-0 items-center justify-between gap-2 border-t border-edge-muted px-3 py-2 text-xs"
            onPointerDown={keepSearchFocus}
            onMouseDown={keepSearchFocus}
          >
            <span class="font-medium">
              <Show when={days()}>
                {(count) => `${count()} ${count() === 1 ? 'day' : 'days'}`}
              </Show>
            </span>
            <span class="flex items-center gap-1 text-ink-muted">
              <button
                type="button"
                class="rounded px-1 py-0.5 not-touch:hover:bg-hover touch:min-h-11"
                onClick={() => clear(['start'])}
              >
                Clear start
              </button>
              <Show when={props.dates.due}>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  class="rounded px-1 py-0.5 not-touch:hover:bg-hover touch:min-h-11"
                  onClick={() => clear(['start', 'due'])}
                >
                  Clear both
                </button>
              </Show>
            </span>
          </div>
        </Show>
      }
    />
  );
}
