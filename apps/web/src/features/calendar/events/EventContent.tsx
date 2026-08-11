import type { EventContentArg } from '@fullcalendar/core';
import { cn } from '@ui';
import { Show } from 'solid-js';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '../time-format';
import type { CalendarEvent, CalendarTimeFormat } from './types';

interface CalendarEventContentProps {
  event: CalendarEvent;
  renderProps: EventContentArg;
  isSelected: boolean;
  timeFormat: CalendarTimeFormat;
  isNarrow?: boolean;
}

const SINGLE_LINE_EVENT_DURATION_MS = 15 * 60 * 1000;

/** Renders responsive event content for FullCalendar. */
export function CalendarEventContent(props: CalendarEventContentProps) {
  const isCompact = () =>
    props.event.allDay || props.renderProps.view.type === 'dayGridMonth';
  const showLocation = () =>
    !props.event.allDay && props.renderProps.view.type === 'timeGridDay';
  const selfResponseStatus = () =>
    props.event.attendees.find((attendee) => attendee.isSelf)?.responseStatus;
  const usesSingleLineLayout = () => {
    const duration =
      new Date(props.event.end).getTime() -
      new Date(props.event.start).getTime();

    return (
      !props.event.allDay &&
      duration > 0 &&
      duration <= SINGLE_LINE_EVENT_DURATION_MS
    );
  };
  const timeText = () => {
    if (props.isNarrow || props.event.allDay) return undefined;

    const start = new Date(props.event.start);
    const end = new Date(props.event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return props.renderProps.timeText;
    }

    const formattedStart = formatCompactCalendarTime(start, props.timeFormat);
    if (isCompact() || usesSingleLineLayout()) return formattedStart;

    return formatCompactCalendarTimeRange(start, end, props.timeFormat);
  };

  return (
    <div
      class={cn(
        'calendar-event-content w-full min-w-0 overflow-hidden',
        !isCompact() && 'h-full min-h-0',
        props.isSelected && 'calendar-event-content-selected'
      )}
      data-response-status={selfResponseStatus()}
    >
      <div
        class={cn(
          'calendar-event-content-layout flex w-full min-h-0 flex-col overflow-hidden',
          !isCompact() && 'h-full',
          isCompact() && 'calendar-event-content-compact',
          (isCompact() || usesSingleLineLayout()) &&
            'calendar-event-content-layout-single-line'
        )}
      >
        <span
          class={cn(
            'calendar-event-title max-w-full shrink-0 font-semibold leading-tight',
            props.isNarrow ? 'whitespace-nowrap' : 'truncate'
          )}
        >
          {props.event.title}
        </span>
        <Show when={timeText()}>
          {(text) => (
            <span class="calendar-event-time mt-0.5 shrink-0 truncate leading-tight opacity-85 tabular-nums">
              {text()}
            </span>
          )}
        </Show>
        <Show when={showLocation() && props.event.location}>
          <span class="calendar-event-metadata calendar-event-location mt-1 shrink-0 truncate leading-tight opacity-80">
            {props.event.location}
          </span>
        </Show>
      </div>
    </div>
  );
}
