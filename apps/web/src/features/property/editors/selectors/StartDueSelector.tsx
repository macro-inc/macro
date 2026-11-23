import { DatePickerUI } from '@core/component/DatePicker/DatePickerUI';
import ClockIcon from '@icon/system/regular/clock.svg';
import { cn } from '@ui';
import { startOfDay } from 'date-fns';
import { createSignal, type JSX, Show } from 'solid-js';
import {
  clockIs12Hour,
  type DateField,
  pickDay,
  type StartDue,
  startDueLength,
  withoutTimes,
  withTimes,
} from '../../utils/start-due';
import { PropertyDateSelector } from './PropertyDateSelector';
import { StartDueTimes } from './StartDueTimes';

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

const ENDS: DateField[] = ['start', 'due'];

/**
 * The dates picker of a task or project: a Start and a Due field over the
 * date suggestions, which set the field that is active, and a calendar that
 * picks the range. A suggestion closes the picker, as a due date's does. In
 * the calendar a start moves on to the due date and a due date closes it.
 * Add time gives both ends a time of day and turns the list into clock
 * times; Remove time makes them whole days again.
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
    props.onChange(picked.dates, picked.changed);
  };

  // A first start moves on to the due date, setting a range; a start that
  // existed stays active, so a second click corrects it.
  const pickFromCalendar = (day: Date) => {
    const active = field();
    const hadStart = props.dates.start != null;
    const picked = pickDay(props.dates, active, day);
    props.onChange(picked.dates, picked.changed);
    if (active === 'due' && picked.changed.includes('due')) {
      props.onClose?.();
      return;
    }
    if (active === 'start' && picked.changed.includes('start') && !hadStart) {
      setField('due');
    }
  };

  const fieldTime = (date: Date) =>
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: clockIs12Hour(),
    })
      .format(date)
      .replace(/\u202f/g, ' ');

  const setTimes = (next: StartDue) => {
    props.onChange(
      next,
      ENDS.filter((end) => next[end] != null)
    );
    const active = field();
    if (!next[active]) setField(active === 'start' ? 'due' : 'start');
  };

  const fieldButton = (end: DateField, label: string) => {
    const value = () => props.dates[end];
    return (
      <button
        type="button"
        class={cn(
          'flex min-w-0 flex-col items-start rounded-md border px-2 py-1 text-left touch:min-h-12',
          field() === end
            ? 'border-ink ring-1 ring-ink'
            : 'border-edge-muted not-touch:hover:bg-hover'
        )}
        aria-pressed={field() === end}
        onClick={() => setField(end)}
      >
        <span
          class={cn(
            'text-xs',
            field() === end ? 'font-medium text-ink' : 'text-ink-muted'
          )}
        >
          {label}
        </span>
        <span class={cn('truncate', !value() && 'text-ink-muted')}>
          {value() ? FIELD_DAY_FORMAT.format(value()!) : 'None'}
        </span>
        <Show when={props.dates.timed && value()}>
          {(at) => <span class="text-ink-muted">{fieldTime(at())}</span>}
        </Show>
      </button>
    );
  };

  const clear = (ends: DateField[]) => {
    const next = { ...props.dates };
    for (const end of ends) next[end] = null;
    props.onChange(next, ends);
  };

  const header = () => (
    <div
      class="grid shrink-0 grid-cols-2 gap-1.5 border-b border-edge-muted p-1.5"
      onPointerDown={keepSearchFocus}
      onMouseDown={keepSearchFocus}
    >
      {fieldButton('start', 'Start')}
      {fieldButton('due', 'Due')}
    </div>
  );

  const footerLink = (label: string, onClick: () => void) => (
    <button
      type="button"
      class="rounded px-1 py-0.5 not-touch:hover:bg-hover touch:min-h-11"
      onClick={onClick}
    >
      {label}
    </button>
  );

  const footer = (links: JSX.Element) => (
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-t border-edge-muted px-3 py-2 text-xs"
      onPointerDown={keepSearchFocus}
      onMouseDown={keepSearchFocus}
    >
      <span class="font-medium">{startDueLength(props.dates)}</span>
      <span class="flex items-center gap-1 text-ink-muted">{links}</span>
    </div>
  );

  return (
    <Show
      when={!props.dates.timed}
      fallback={
        <Show when={field()} keyed>
          {(active) => (
            <StartDueTimes
              dates={props.dates}
              field={active}
              onFieldChange={setField}
              hour12={clockIs12Hour()}
              onChange={props.onChange}
              onClose={props.onClose}
              fillHeight={props.fillHeight}
              header={header()}
              footer={footer(
                <>
                  {footerLink('Remove time', () =>
                    setTimes(withoutTimes(props.dates))
                  )}
                  <Show when={props.dates.start && props.dates.due}>
                    <span aria-hidden="true">·</span>
                    {footerLink('Clear both', () => clear(ENDS))}
                  </Show>
                </>
              )}
            />
          )}
        </Show>
      }
    >
      <PropertyDateSelector
        property={{ displayName: props.names[field()] }}
        selectedDate={props.dates[field()]}
        onSelectDate={select}
        onClose={props.onClose}
        fillHeight={props.fillHeight}
        header={header()}
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
          <>
            <button
              type="button"
              class="flex w-full shrink-0 items-center justify-between gap-2 border-t border-edge-muted px-3 py-2 text-left not-touch:hover:bg-hover touch:min-h-12"
              onPointerDown={keepSearchFocus}
              onMouseDown={keepSearchFocus}
              onClick={() => setTimes(withTimes(props.dates))}
            >
              <span class="flex items-center gap-2">
                <ClockIcon class="size-4 text-ink-muted" />
                Add time
              </span>
              <span class="text-xs text-ink-muted">Whole days</span>
            </button>
            <Show when={props.dates.start}>
              {footer(
                <>
                  {footerLink('Clear start', () => clear(['start']))}
                  <Show when={props.dates.due}>
                    <span aria-hidden="true">·</span>
                    {footerLink('Clear both', () => clear(ENDS))}
                  </Show>
                </>
              )}
            </Show>
          </>
        }
      />
    </Show>
  );
}
