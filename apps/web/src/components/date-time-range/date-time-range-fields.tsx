import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { cn } from '@ui/utils/classname';
import { type JSX, Show } from 'solid-js';
import { type DateTimeRangeProps, Root } from './date-time-range-context';
import { EndDate } from './end-date';
import { EndTime } from './end-time';
import { StartDate } from './start-date';
import { StartTime } from './start-time';

/** The start's date and, unless all day, its time. */
function Start() {
  return (
    <span class="flex items-center gap-1">
      <StartDate />
      <StartTime />
    </span>
  );
}

/** The end's date and, unless all day, its time. */
function End() {
  return (
    <span class="flex items-center gap-1">
      <EndDate />
      <EndTime />
    </span>
  );
}

/**
 * Parts of a date/time range, for hosts that lay out its start and end
 * themselves; `DateTimeRangeFields` is the inline layout.
 */
export const DateTimeRange = {
  Root,
  Start,
  End,
  StartDate,
  EndDate,
  StartTime,
  EndTime,
};

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
