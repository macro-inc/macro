import { onElementConnect } from '@core/util/onElementConnect';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui/components/Button';
import {
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { DateTimeRangeFields } from './date-time-range-fields';
import {
  type DateTimeRangeValue,
  dateTimeRangeValue,
  EMPTY_DATE_TIME_RANGE,
  moveAllDayRange,
  moveTimedRange,
  type TimeRange,
  timeRangeFromValue,
  withAllDay,
} from './time-range';

/**
 * Edits a stored time range in a menu or popover, on one row: Start → End
 * fields, All day, and a Clear icon. Every change that leaves a complete range
 * in order saves at once; one ending before it starts is shown, never saved. The host closes
 * it, and should give its content `portal-scope` and visible overflow so the
 * fields' date and time lists open inside it.
 */
export function TimeRangeEditor(props: {
  /** What the range is of, e.g. a column's name, for the fields' labels. */
  subject: string;
  range: TimeRange | undefined;
  /** Every complete, ordered change, or `null` once cleared. */
  onChange: (range: TimeRange | null) => void;
  /** Called after Clear. */
  onClear?: () => void;
}) {
  const [value, setValue] = createSignal<DateTimeRangeValue>(
    props.range ? dateTimeRangeValue(props.range) : EMPTY_DATE_TIME_RANGE
  );
  const errorId = createUniqueId();
  let root!: HTMLDivElement;
  // The host menu focuses itself once open, and again when a date or time
  // list closes; hand that focus on to the start field.
  onMount(() =>
    onElementConnect(root, () => {
      const host = root.closest<HTMLElement>('.portal-scope');
      if (!host) return;
      const focusStart = () => root.querySelector('button')?.focus();
      const onFocusIn = (event: FocusEvent) => {
        if (event.target === host) focusStart();
      };
      host.addEventListener('focusin', onFocusIn);
      onCleanup(() => host.removeEventListener('focusin', onFocusIn));
      if (document.activeElement === host) focusStart();
    })
  );

  const backwards = () => {
    const range = timeRangeFromValue(value());
    return range !== undefined && range.end < range.start;
  };

  const change = (next: DateTimeRangeValue) => {
    setValue(next);
    const range = timeRangeFromValue(next);
    if (range && range.end >= range.start) props.onChange(range);
  };

  const clear = () => {
    setValue(EMPTY_DATE_TIME_RANGE);
    props.onChange(null);
    props.onClear?.();
  };

  return (
    <div
      ref={root}
      class="flex min-w-0 flex-col gap-2 p-3"
      // Keep keys from the host menu's own handling: it would take Escape
      // from an open date list (the list closes on it, then the menu) and
      // arrow keys from the fields. Tab moves on from the buttons through the
      // host; from a time field the browser moves it, after the field commits.
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.key === 'Tab' &&
          target instanceof Node &&
          root.contains(target) &&
          !(target instanceof HTMLInputElement)
        )
          return;
        event.stopPropagation();
      }}
    >
      <DateTimeRangeFields
        subject={props.subject}
        start={value().start}
        end={value().end}
        allDay={value().allDay}
        onStartChange={(start) =>
          change(
            value().allDay
              ? moveAllDayRange(value(), start)
              : moveTimedRange(value(), start)
          )
        }
        onEndChange={(end) =>
          change({ ...value(), start: value().start || end, end })
        }
        onAllDayChange={(allDay) => change(withAllDay(value(), allDay))}
        invalid={backwards()}
        describedBy={backwards() ? errorId : undefined}
        trailing={
          <Show when={props.range || value().start}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Clear ${props.subject}`}
              tooltip="Clear"
              onClick={clear}
            >
              <XIcon />
            </Button>
          </Show>
        }
      />
      <Show when={backwards()}>
        <p id={errorId} role="alert" class="text-xs text-failure">
          The end can’t be before the start.
        </p>
      </Show>
    </div>
  );
}
