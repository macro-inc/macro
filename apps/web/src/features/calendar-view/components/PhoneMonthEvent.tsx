import type {
  CalendarEvent,
  CalendarTimeFormat,
} from '@app/features/calendar/types';
import { formatEventSchedule } from '@app/features/calendar/utils/event-schedule';
import { calendarEventLocation } from '@app/features/calendar/utils/macro-call-link';
import { formatCompactCalendarTimeRange } from '@app/features/calendar/utils/time-format';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { emailToId } from '@core/user';
import { For, Show } from 'solid-js';

export function PhoneMonthEvent(props: {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
  onSelect: (event: CalendarEvent, element: HTMLElement) => void;
}) {
  const time = () =>
    props.event.allDay
      ? formatEventSchedule(props.event, props.timeFormat)
      : formatCompactCalendarTimeRange(
          new Date(props.event.start),
          new Date(props.event.end),
          props.timeFormat
        );
  const location = () => calendarEventLocation(props.event);
  return (
    <button
      data-calendar-month-event={props.event.id}
      type="button"
      class="calendar-agenda-event flex min-h-11 w-full items-start gap-2 rounded-xl px-2.5 py-1 text-left text-sm"
      style={{ '--event-calendar-color': props.event.calendar.color }}
      onClick={(event) => props.onSelect(props.event, event.currentTarget)}
    >
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">
          {props.event.title || t('calendar.agendaUntitled')}
        </span>
        <span class="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
          <span class="shrink-0">{time()}</span>
          <Show when={location()}>
            {(place) => <span class="truncate">{place()}</span>}
          </Show>
        </span>
      </span>
      <Show when={props.event.attendees.length}>
        <span class="flex shrink-0 -space-x-1 pt-0.5">
          <For each={props.event.attendees.slice(0, 4)}>
            {(attendee) => (
              <span class="size-5">
                <UserIcon
                  id={emailToId(attendee.email)}
                  name={attendee.displayName || attendee.email}
                  size="fill"
                  suppressClick
                  showTooltip={false}
                />
              </span>
            )}
          </For>
        </span>
      </Show>
    </button>
  );
}
