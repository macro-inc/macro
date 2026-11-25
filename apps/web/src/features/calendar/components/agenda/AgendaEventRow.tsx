import { t } from '@app/lib/i18n';
import { Button, cn } from '@ui';
import type { ParentProps } from 'solid-js';
import type { CalendarEvent, CalendarTimeFormat } from '../../types';
import { formatEventSchedule } from '../../utils/event-schedule';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '../../utils/time-format';
import '../../calendar.css';

export type AgendaEventRowProps = ParentProps<{
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
  selected?: boolean;
  onSelect: (element: HTMLElement) => void;
}>;

/** Shares the grid's event surface while keeping the list's time column and reply area. */
export function AgendaEventRow(props: AgendaEventRowProps) {
  const start = () => new Date(props.event.start);
  const end = () => new Date(props.event.end);
  const response = () =>
    props.event.attendees.find((guest) => guest.isSelf)?.responseStatus;
  const startLabel = () =>
    props.event.allDay
      ? t('calendar.allDay')
      : formatCompactCalendarTime(start(), props.timeFormat);
  const rangeLabel = () => {
    if (props.event.allDay)
      return formatEventSchedule(props.event, props.timeFormat);
    if (start().getTime() === end().getTime()) return startLabel();
    return formatCompactCalendarTimeRange(start(), end(), props.timeFormat);
  };

  return (
    <div class="flex w-full max-w-2xl items-start gap-3 px-5 py-1">
      <time
        class="w-16 shrink-0 pt-2 text-xs text-ink-muted tabular-nums"
        dateTime={props.event.start}
      >
        {startLabel()}
      </time>
      <div
        class="calendar-agenda-event min-w-0 flex-1 overflow-hidden focus-within:ring-1 focus-within:ring-accent"
        data-response-status={response()}
        data-selected={props.selected || undefined}
        style={{ '--event-calendar-color': props.event.calendar.color }}
      >
        <Button
          variant="ghost"
          appearance="bare"
          size="lg"
          fullWidth
          class="text-inherit"
          onClick={(event) => props.onSelect(event.currentTarget)}
        >
          <span class="flex min-w-0 flex-1 flex-col items-start py-1 text-left">
            <span
              class={cn(
                'w-full truncate text-sm font-semibold',
                response() === 'declined' && 'line-through'
              )}
            >
              {props.event.title || t('calendar.agendaUntitled')}
            </span>
            <span class="text-xs font-normal opacity-85 tabular-nums">
              {rangeLabel()}
            </span>
          </span>
        </Button>
        {props.children}
      </div>
    </div>
  );
}
