import { Popover } from '@kobalte/core/popover';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { cn } from '@ui/utils/classname';
import { createSignal, createUniqueId } from 'solid-js';
import { formatLocalDate, parseLocalDate } from '../../utils/calendar-date';
import { dateLabelFormatter, EventTimeInput } from './EventDateTimeInputs';
import {
  DAY_TIME_OPTIONS,
  dayOffsetBetween,
  type EventTimeOption,
  endTimeOptions,
  endValueFor,
  formatTimeValue,
  selectedTimeOptionId,
  splitLocalDateTime,
  withinEndTimeWindow,
  withLocalDate,
  withLocalTime,
} from './event-time-options';

interface EventDateTimeDropdownProps {
  id: string;
  label: 'Start' | 'End';
  value: string;
  allDay: boolean;
  /**
   * Range start the offered times are measured from, present on the end
   * field: its options carry the duration they produce and roll into the
   * following day past midnight.
   */
  anchorStart?: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  fieldDisabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placement: 'bottom-start' | 'bottom-end';
}

function EventDateTimeDropdown(props: EventDateTimeDropdownProps) {
  const [open, setOpen] = createSignal(false);
  const parts = () => splitLocalDateTime(props.value);
  const selectedDate = () => parseLocalDate(parts().date);
  const label = () => {
    const date = selectedDate();
    const dateLabel = date
      ? dateLabelFormatter.format(date)
      : `${props.label} date`;
    if (props.allDay) return dateLabel;
    return `${dateLabel} ${formatTimeValue(parts().time) ?? 'Time'}`;
  };
  const anchor = () => {
    const start = props.anchorStart;
    if (!start || !withinEndTimeWindow(start, props.value)) return undefined;
    return start;
  };
  const timeOptions = () => {
    const start = anchor();
    return start
      ? endTimeOptions(splitLocalDateTime(start).time)
      : DAY_TIME_OPTIONS;
  };
  const selectedTimeId = () => {
    const start = anchor();
    return selectedTimeOptionId(
      parts().time,
      start ? dayOffsetBetween(start, props.value) : 0
    );
  };
  const changeTime = (option: EventTimeOption) => {
    const start = anchor();
    props.onTimeChange(
      start
        ? endValueFor(start, option)
        : withLocalTime(props.value, option.value)
    );
  };

  return (
    <Popover
      open={open() && !props.fieldDisabled}
      onOpenChange={(nextOpen) => setOpen(!props.fieldDisabled && nextOpen)}
      placement={props.placement}
      gutter={4}
      flip
      slide
    >
      <Popover.Trigger
        disabled={props.fieldDisabled}
        aria-label={`Edit event ${props.label.toLowerCase()} date and time`}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        class={cn(
          'group inline-flex h-7 w-fit max-w-48 min-w-0 items-center justify-between gap-1.5 rounded-lg border border-edge-muted bg-surface px-2 py-1 text-left text-xs leading-tight text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-active focus-visible:text-ink focus-visible:ring-accent/10 data-expanded:bg-hover data-expanded:text-ink',
          open() && 'bg-hover text-ink',
          props.invalid &&
            'border-failure text-failure hover:text-failure focus-visible:text-failure data-expanded:text-failure'
        )}
      >
        <CalendarBlankIcon
          class={cn(
            'size-3.5 shrink-0',
            props.invalid
              ? 'text-failure'
              : 'text-ink-extra-muted group-hover:text-ink-muted group-focus-visible:text-ink-muted'
          )}
        />
        <span class="min-w-0 flex-1 truncate">{label()}</span>
        <CaretDownIcon
          class={cn(
            'size-3 shrink-0',
            props.invalid
              ? 'text-failure'
              : 'text-ink-extra-muted group-hover:text-ink-muted group-focus-visible:text-ink-muted'
          )}
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-action-menu w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-edge bg-menu shadow-menu menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="px-3 pt-3 text-xs font-medium text-ink">
              {props.label} {props.allDay ? 'date' : 'date and time'}
            </Popover.Title>
            <div class="p-3">
              <Calendar
                required
                fixedWeeks
                value={selectedDate()}
                onValueChange={(date) => {
                  if (!date || props.fieldDisabled) return;
                  props.onDateChange(formatLocalDate(date));
                }}
              />
            </div>

            <div class="border-t border-edge p-3">
              <div class={cn(props.allDay && 'opacity-50')}>
                <EventTimeInput
                  id={props.id}
                  label={`${props.label} time`}
                  value={parts().time}
                  options={timeOptions()}
                  selectedId={selectedTimeId()}
                  onChange={changeTime}
                  disabled={props.fieldDisabled || props.allDay}
                />
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}

export interface EventDateTimeRangeFieldsProps {
  start: string;
  end: string;
  allDay: boolean;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAllDayChange: (allDay: boolean) => void;
  startDisabled?: boolean;
  endDisabled?: boolean;
  allDayDisabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

/** Separate start/end date-time dropdowns joined by a directional arrow. */
export function EventDateTimeRangeFields(props: EventDateTimeRangeFieldsProps) {
  const fieldId = createUniqueId();

  return (
    <div class="flex w-full items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <EventDateTimeDropdown
          id={`composer-start-time-${fieldId}`}
          label="Start"
          value={props.start}
          allDay={props.allDay}
          onDateChange={(date) =>
            props.onStartChange(
              props.allDay ? date : withLocalDate(props.start, date)
            )
          }
          onTimeChange={props.onStartChange}
          fieldDisabled={props.startDisabled}
          invalid={props.invalid}
          describedBy={props.describedBy}
          placement="bottom-start"
        />
        <ArrowRightIcon
          aria-label="to"
          class={cn(
            'size-3.5 shrink-0 text-ink-extra-muted',
            props.invalid && 'text-failure'
          )}
        />
        <EventDateTimeDropdown
          id={`composer-end-time-${fieldId}`}
          label="End"
          value={props.end}
          allDay={props.allDay}
          anchorStart={props.allDay ? undefined : props.start}
          onDateChange={(date) =>
            props.onEndChange(
              props.allDay ? date : withLocalDate(props.end, date)
            )
          }
          onTimeChange={props.onEndChange}
          fieldDisabled={props.endDisabled}
          invalid={props.invalid}
          describedBy={props.describedBy}
          placement="bottom-end"
        />
      </div>
      <ToggleSwitch
        checked={props.allDay}
        disabled={props.allDayDisabled}
        onChange={props.onAllDayChange}
        size="sm"
        label="All day"
        labelClass="whitespace-nowrap text-xs text-ink-muted"
        class="shrink-0"
      />
    </div>
  );
}
