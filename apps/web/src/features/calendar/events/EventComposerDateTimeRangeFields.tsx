import { Popover } from '@kobalte/core/popover';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Calendar } from '@ui/components/Calendar';
import { Layer } from '@ui/components/Layer';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { cn } from '@ui/utils/classname';
import { createSignal, createUniqueId } from 'solid-js';
import {
  dateLabelFormatter,
  EventTimeInput,
  formatLocalDate,
  parseLocalDate,
  splitLocalDateTime,
  timeLabelFormatter,
  withLocalDate,
  withLocalTime,
} from './EventDateTimeField';

function formatTime(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  if (hour === undefined || minute === undefined) return 'Time';
  return timeLabelFormatter.format(new Date(2000, 0, 1, hour, minute));
}

export interface EventComposerDateTimeRangeFieldsProps {
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

/** Combined date-range display with start/end calendar and time controls. */
export function EventComposerDateTimeRangeFields(
  props: EventComposerDateTimeRangeFieldsProps
) {
  const fieldId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;

  const startParts = () => splitLocalDateTime(props.start);
  const endParts = () => splitLocalDateTime(props.end);
  const startDate = () => parseLocalDate(startParts().date);
  const endDate = () => parseLocalDate(endParts().date);
  const disabled = () =>
    props.startDisabled && props.endDisabled && props.allDayDisabled;
  const rangeLabel = () => {
    const start = startDate();
    const end = endDate();
    const startLabel = start ? dateLabelFormatter.format(start) : 'Start date';
    const endLabel = end ? dateLabelFormatter.format(end) : 'End date';
    if (props.allDay) return `${startLabel} – ${endLabel}`;
    return `${startLabel} ${formatTime(startParts().time)} – ${endLabel} ${formatTime(endParts().time)}`;
  };

  return (
    <Popover
      anchorRef={() => trigger}
      open={open() && !disabled()}
      onOpenChange={(nextOpen) => setOpen(!disabled() && nextOpen)}
      placement="bottom-start"
      gutter={4}
      flip
      slide
    >
      <button
        ref={trigger}
        type="button"
        disabled={disabled()}
        aria-label="Edit event date and time range"
        aria-expanded={open()}
        aria-haspopup="dialog"
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        class={cn(
          'group inline-flex min-h-8 w-fit max-w-full self-start items-center gap-2 rounded-lg bg-transparent px-2 text-left text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink focus-visible:ring focus-visible:ring-accent/10',
          open() && 'bg-hover',
          props.invalid && 'text-failure'
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarBlankIcon
          class={cn(
            'size-3.5 shrink-0',
            props.invalid
              ? 'text-failure'
              : 'text-ink-extra-muted group-hover:text-ink-muted group-focus-visible:text-ink-muted'
          )}
        />
        <span class="min-w-0 truncate">{rangeLabel()}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted group-hover:text-ink-muted group-focus-visible:text-ink-muted" />
      </button>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="portal-scope z-action-menu w-[38rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-edge bg-menu shadow-menu menu-open-animation"
            on:keydown={(event: KeyboardEvent) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="sr-only">
              Choose event date and time range
            </Popover.Title>
            <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start">
              <div class="min-w-0 p-3">
                <Calendar
                  required
                  fixedWeeks
                  value={startDate()}
                  onValueChange={(date) => {
                    if (!date || props.startDisabled) return;
                    const nextDate = formatLocalDate(date);
                    props.onStartChange(
                      props.allDay
                        ? nextDate
                        : withLocalDate(props.start, nextDate)
                    );
                  }}
                />
              </div>
              <ArrowRightIcon
                aria-label="to"
                class="mt-[1.125rem] size-4 shrink-0 text-ink-extra-muted"
              />
              <div class="min-w-0 p-3">
                <Calendar
                  required
                  fixedWeeks
                  value={endDate()}
                  onValueChange={(date) => {
                    if (!date || props.endDisabled) return;
                    const nextDate = formatLocalDate(date);
                    props.onEndChange(
                      props.allDay
                        ? nextDate
                        : withLocalDate(props.end, nextDate)
                    );
                  }}
                />
              </div>
            </div>

            <div class="border-t border-edge p-3">
              <div class="grid grid-cols-2 gap-3">
                <div class={cn(props.allDay && 'opacity-50')}>
                  <EventTimeInput
                    id={`composer-start-time-${fieldId}`}
                    label="Start time"
                    value={startParts().time}
                    onChange={(time) =>
                      props.onStartChange(withLocalTime(props.start, time))
                    }
                    disabled={props.startDisabled || props.allDay}
                  />
                </div>
                <div class={cn(props.allDay && 'opacity-50')}>
                  <EventTimeInput
                    id={`composer-end-time-${fieldId}`}
                    label="End time"
                    value={endParts().time}
                    onChange={(time) =>
                      props.onEndChange(withLocalTime(props.end, time))
                    }
                    disabled={props.endDisabled || props.allDay}
                  />
                </div>
              </div>
              <div class="mt-3 flex items-center gap-2">
                <ToggleSwitch
                  checked={props.allDay}
                  disabled={props.allDayDisabled}
                  onChange={props.onAllDayChange}
                  size="sm"
                  aria-label="All day"
                />
                <span class="text-xs text-ink-muted">All day</span>
              </div>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
