import type { EventContentArg } from '@fullcalendar/core';
import ExclamationIcon from '@phosphor/exclamation-mark.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import type { CalendarEvent, CalendarTimeFormat } from '../types';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from '../utils/time-format';

interface EventContentProps {
  event: CalendarEvent;
  renderProps: EventContentArg;
  isSelected: boolean;
  timeFormat: CalendarTimeFormat;
  isNarrow?: boolean;
}

const SINGLE_LINE_EVENT_DURATION_MS = 15 * 60 * 1000;

/** Whether the viewer is the only attendee who has not declined the event. */
export function hasEveryoneElseDeclined(
  event: Pick<CalendarEvent, 'attendees' | 'isCancelled'>
) {
  if (event.isCancelled) return false;

  const self = event.attendees.find((attendee) => attendee.isSelf);
  if (!self || self.responseStatus === 'declined') return false;

  const otherAttendees = event.attendees.filter((attendee) => !attendee.isSelf);
  return (
    otherAttendees.length > 0 &&
    otherAttendees.every((attendee) => attendee.responseStatus === 'declined')
  );
}

/** Renders responsive event content for FullCalendar. */
export function EventContent(props: EventContentProps) {
  const isRenderedAllDay = () => props.renderProps.event.allDay;
  const isCompact = () =>
    isRenderedAllDay() || props.renderProps.view.type === 'dayGridMonth';
  const showLocation = () =>
    !isRenderedAllDay() && props.renderProps.view.type === 'timeGridDay';
  const selfResponseStatus = () =>
    props.event.attendees.find((attendee) => attendee.isSelf)?.responseStatus;
  const everyoneElseDeclined = () => hasEveryoneElseDeclined(props.event);
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
        <span class="calendar-event-title-row flex max-w-full min-w-0 shrink-0 items-center gap-0.5">
          <Show when={everyoneElseDeclined()}>
            <span
              role="img"
              aria-label="Everyone else declined"
              title="Everyone else declined"
              class="calendar-event-everyone-declined-indicator flex size-2.5 shrink-0 items-center justify-center rounded-[2px]"
            >
              <ExclamationIcon aria-hidden="true" class="size-2" />
            </span>
          </Show>
          <span
            class={cn(
              'calendar-event-title min-w-0 max-w-full shrink font-semibold leading-tight',
              props.isNarrow ? 'whitespace-nowrap' : 'truncate'
            )}
          >
            {props.event.title}
          </span>
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
