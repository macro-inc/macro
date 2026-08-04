import type { EventContentArg } from '@fullcalendar/core';
import { Show } from 'solid-js';
import { formatCalendarTime } from '../time-format';
import type { CalendarEvent, CalendarTimeFormat } from './types';

interface CalendarEventContentProps {
  event: CalendarEvent;
  renderProps: EventContentArg;
  isSelected: boolean;
  timeFormat: CalendarTimeFormat;
}

const SINGLE_LINE_EVENT_DURATION_MS = 15 * 60 * 1000;

/** Renders responsive event content for FullCalendar. */
export function CalendarEventContent(props: CalendarEventContentProps) {
  const isCompact = () =>
    props.event.allDay || props.renderProps.view.type === 'dayGridMonth';
  const showLocation = () =>
    !props.event.allDay && props.renderProps.view.type === 'timeGridDay';
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
    const start = props.renderProps.event.start;

    return usesSingleLineLayout() && start
      ? formatCalendarTime(start, props.timeFormat)
      : props.renderProps.timeText;
  };

  return (
    <div
      class="calendar-event-content w-full min-w-0 overflow-hidden"
      classList={{
        'h-full': !isCompact(),
        'min-h-0': !isCompact(),
        'calendar-event-content-selected': props.isSelected,
      }}
    >
      <div
        class="calendar-event-content-layout flex w-full min-h-0 flex-col overflow-hidden"
        classList={{
          'h-full': !isCompact(),
          'calendar-event-content-compact': isCompact(),
          'calendar-event-content-layout-single-line':
            isCompact() || usesSingleLineLayout(),
        }}
      >
        <span class="calendar-event-title shrink-0 truncate font-semibold leading-tight">
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
