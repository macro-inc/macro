import type { EventContentArg } from '@fullcalendar/core';
import { Show } from 'solid-js';
import type { CalendarEvent } from './types';

interface CalendarEventContentProps {
  event: CalendarEvent;
  renderProps: EventContentArg;
}

/** Renders responsive event content for FullCalendar. */
export function CalendarEventContent(props: CalendarEventContentProps) {
  const isCompact = () =>
    props.event.allDay || props.renderProps.view.type === 'dayGridMonth';
  const showLocation = () =>
    !props.event.allDay && props.renderProps.view.type === 'timeGridDay';

  return (
    <Show
      when={!isCompact()}
      fallback={
        <div class="flex min-w-0 items-center gap-1 overflow-hidden px-1 py-0.5 text-[0.6875rem] leading-tight">
          <Show when={props.renderProps.timeText}>
            {(timeText) => (
              <span class="shrink-0 font-semibold tabular-nums">
                {timeText()}
              </span>
            )}
          </Show>
          <span class="truncate font-medium">{props.event.title}</span>
        </div>
      }
    >
      <div class="flex size-full min-h-0 flex-col overflow-hidden p-1">
        <span class="truncate text-xs font-semibold leading-tight">
          {props.event.title}
        </span>
        <Show when={props.renderProps.timeText}>
          {(timeText) => (
            <span class="mt-0.5 truncate text-[0.6875rem] leading-tight opacity-85 tabular-nums">
              {timeText()}
            </span>
          )}
        </Show>
        <Show when={showLocation() && props.event.location}>
          <span class="mt-1 truncate text-[0.6875rem] leading-tight opacity-80">
            {props.event.location}
          </span>
        </Show>
      </div>
    </Show>
  );
}
