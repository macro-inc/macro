import { ScopedPortal } from '@core/component/ScopedPortal';
import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import { Popover } from '@kobalte/core/popover';
import { buttonClasses } from '@ui/components/Button';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { cn } from '@ui/utils/classname';
import {
  createContext,
  createSignal,
  createUniqueId,
  type JSX,
  Show,
  useContext,
} from 'solid-js';
import { dateLabelFormatter, TimeInput } from './time-input';
import {
  DAY_TIME_OPTIONS,
  dayOffsetBetween,
  endTimeOptions,
  endValueFor,
  selectedTimeOptionId,
  splitLocalDateTime,
  type TimeOption,
  withinEndTimeWindow,
  withLocalDate,
  withLocalTime,
} from './time-options';

interface DateFieldProps {
  id?: string;
  subject: string;
  label: 'Start' | 'End';
  /** `YYYY-MM-DD`, or empty. */
  date: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placement: 'bottom-start' | 'bottom-end';
}

/** One end's day: a button showing it that opens a month calendar. */
function DateField(props: DateFieldProps) {
  const [open, setOpen] = createSignal(false);
  const selectedDate = () => parseLocalDate(props.date);

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={(nextOpen) => setOpen(!props.disabled && nextOpen)}
      placement={props.placement}
      gutter={4}
      flip
      slide
    >
      <Popover.Trigger
        id={props.id}
        disabled={props.disabled}
        aria-label={`Edit ${props.subject} ${props.label.toLowerCase()} date`}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        class={buttonClasses({
          variant: 'secondary',
          size: 'xs',
          class: cn(
            // A touch more room after the date than the icon has before it.
            'max-w-40 justify-start pr-2.5',
            props.invalid && 'border-failure text-failure'
          ),
        })}
      >
        <CalendarBlankIcon class="size-3.5 shrink-0" />
        <span class="truncate">
          {selectedDate()
            ? dateLabelFormatter.format(selectedDate())
            : `${props.label} date`}
        </span>
      </Popover.Trigger>

      <ScopedPortal scope="local">
        <Layer depth={3}>
          <Popover.Content
            class="menu-surface z-action-menu w-72 max-w-[calc(100vw-1rem)] p-3 menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">{props.label} date</Popover.Title>
            <Calendar
              required
              fixedWeeks
              value={selectedDate()}
              onValueChange={(date) => {
                if (!date || props.disabled) return;
                props.onChange(formatLocalDate(date));
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Layer>
      </ScopedPortal>
    </Popover>
  );
}

export interface DateTimeRangeProps {
  /** What the range belongs to, named in the fields' labels: `event`, a column's name. */
  subject: string;
  /** The start field's id, for a label to name or a caller to focus. */
  id?: string;
  /** `YYYY-MM-DD` when all day, else local `YYYY-MM-DDTHH:mm`; empty when unset. */
  start: string;
  end: string;
  allDay: boolean;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  startDisabled?: boolean;
  endDisabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

const DateTimeRangeContext = createContext<DateTimeRangeProps>();

function useDateTimeRange() {
  const range = useContext(DateTimeRangeContext);
  if (!range)
    throw new Error('DateTimeRange parts must be rendered inside Root');
  return range;
}

function Root(props: DateTimeRangeProps & { children: JSX.Element }) {
  return (
    <DateTimeRangeContext.Provider value={props}>
      {props.children}
    </DateTimeRangeContext.Provider>
  );
}

/** The start's date and, unless all day, its time. */
function Start() {
  const range = useDateTimeRange();
  const fieldId = createUniqueId();
  const parts = () => splitLocalDateTime(range.start);
  return (
    <span class="flex items-center gap-1">
      <DateField
        id={range.id}
        subject={range.subject}
        label="Start"
        date={parts().date}
        onChange={(date) =>
          range.onStartChange(
            range.allDay ? date : withLocalDate(range.start, date)
          )
        }
        disabled={range.startDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        placement="bottom-start"
      />
      <Show when={!range.allDay}>
        <TimeInput
          id={`range-start-time-${fieldId}`}
          label={`${range.subject} start time`}
          value={parts().time}
          onChange={(option) =>
            range.onStartChange(withLocalTime(range.start, option.value))
          }
          disabled={range.startDisabled}
          invalid={range.invalid}
          describedBy={range.describedBy}
        />
      </Show>
    </span>
  );
}

/**
 * The end's date and, unless all day, its time. The end's list counts from
 * the start and rolls past midnight.
 */
function End() {
  const range = useDateTimeRange();
  const fieldId = createUniqueId();
  const parts = () => splitLocalDateTime(range.end);

  /** The start the end's times count from, while the end is within a day of it. */
  const endAnchor = () => {
    if (range.allDay || !range.start) return undefined;
    return withinEndTimeWindow(range.start, range.end)
      ? range.start
      : undefined;
  };
  const endOptions = () => {
    const start = endAnchor();
    return start
      ? endTimeOptions(splitLocalDateTime(start).time)
      : DAY_TIME_OPTIONS;
  };
  const endSelectedId = () => {
    const start = endAnchor();
    return selectedTimeOptionId(
      parts().time,
      start ? dayOffsetBetween(start, range.end) : 0
    );
  };
  const changeEndTime = (option: TimeOption) => {
    const start = endAnchor();
    range.onEndChange(
      start
        ? endValueFor(start, option)
        : withLocalTime(range.end, option.value)
    );
  };

  return (
    <span class="flex items-center gap-1">
      <DateField
        subject={range.subject}
        label="End"
        date={parts().date}
        onChange={(date) =>
          range.onEndChange(
            range.allDay ? date : withLocalDate(range.end, date)
          )
        }
        disabled={range.endDisabled}
        invalid={range.invalid}
        describedBy={range.describedBy}
        placement="bottom-end"
      />
      <Show when={!range.allDay}>
        <TimeInput
          id={`range-end-time-${fieldId}`}
          label={`${range.subject} end time`}
          value={parts().time}
          options={endOptions()}
          selectedId={endSelectedId()}
          onChange={changeEndTime}
          disabled={range.endDisabled}
          invalid={range.invalid}
          describedBy={range.describedBy}
        />
      </Show>
    </span>
  );
}

/**
 * Parts of a date/time range, for hosts that lay out its start and end
 * themselves; `DateTimeRangeFields` is the inline layout.
 */
export const DateTimeRange = { Root, Start, End };

export interface DateTimeRangeFieldsProps extends DateTimeRangeProps {
  /** Omit to hide the All day control for hosts that only support timed ranges. */
  onAllDayChange?: (allDay: boolean) => void;
  allDayDisabled?: boolean;
  /** A control after All day, e.g. a host's Clear. */
  trailing?: JSX.Element;
}

/**
 * Each end's date and, unless all day, its time, joined by an arrow, then an
 * All day switch, as Google Calendar edits an event's time. Times are typed
 * or picked. An all-day end is the last day, included.
 */
export function DateTimeRangeFields(props: DateTimeRangeFieldsProps) {
  return (
    <DateTimeRange.Root {...props}>
      <div class="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <DateTimeRange.Start />
          <ArrowRightIcon
            aria-hidden={false}
            aria-label="to"
            class={cn(
              'size-3.5 shrink-0 text-ink-extra-muted',
              props.invalid && 'text-failure'
            )}
          />
          <DateTimeRange.End />
        </div>
        <Show when={props.onAllDayChange || props.trailing}>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Show when={props.onAllDayChange}>
              {(onChange) => (
                <ToggleSwitch
                  checked={props.allDay}
                  disabled={props.allDayDisabled}
                  onChange={onChange()}
                  size="sm"
                  label="All day"
                  labelClass="whitespace-nowrap text-xs text-ink-muted"
                />
              )}
            </Show>
            {props.trailing}
          </div>
        </Show>
      </div>
    </DateTimeRange.Root>
  );
}
