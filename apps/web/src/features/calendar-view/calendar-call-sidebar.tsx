import { useUserId } from '@core/context/user';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { useNavigate } from '@solidjs/router';
import { isSameDay, isTomorrow } from 'date-fns';
import { createDeferred } from 'solid-js';
import { useCalendarView } from '../calendar/components/CalendarViewContext';
import { formatCompactCalendarTime } from '../calendar/utils/time-format';
import { calendarCallNavigation } from '../meetings/core/calendar-calls';
import type { UpcomingCalendarEvent } from '../meetings/core/upcoming-calendar-events';
import { createCallSidebarClock } from '../meetings/primitives/call-sidebar';
import { useActiveQuickCallsSource } from '../meetings/queries/active-quick-calls';
import { useUpcomingCalendarEventsSource } from '../meetings/queries/upcoming-calendar-events';
import { useQuickCallsFlag } from '../meetings/use-quick-calls-flag';
import { CallSidebar } from '../meetings/views/call-sidebar';

/** Production wiring, mounted within the section's Suspense boundary. */
export function CalendarCallSidebar() {
  const calendar = useCalendarView();
  const userId = useUserId();
  const quickCalls = useQuickCallsFlag();
  const now = createCallSidebarClock();
  const renderedHiddenSourceIds = createDeferred(calendar.hiddenSourceIds);
  const isRenderedSourceVisible = (sourceId: string) =>
    !renderedHiddenSourceIds().has(sourceId);
  const upcoming = useUpcomingCalendarEventsSource({
    userId,
    sourceById: calendar.sourceById,
    isSourceVisible: isRenderedSourceVisible,
    now,
  });
  const active = useActiveQuickCallsSource(() =>
    quickCalls().enabled ? userId() : undefined
  );
  const navigate = useNavigate();

  function when(call: UpcomingCalendarEvent) {
    const start = new Date(
      call.allDay ? `${call.start.slice(0, 10)}T00:00:00` : call.start
    );
    const day = isSameDay(start, now())
      ? 'Today'
      : isTomorrow(start)
        ? 'Tomorrow'
        : start.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          });
    if (call.allDay) return `${day} · All day`;
    if (start <= now()) return 'Now';
    const time = formatCompactCalendarTime(
      start,
      calendar.displaySettings.timeFormat
    );
    return isSameDay(start, now()) ? time : `${day} · ${time}`;
  }

  return (
    <CallSidebar
      sources={{ upcoming, active }}
      now={now}
      when={when}
      selectedEventId={calendar.selectedEvent()?.id}
      actions={{
        openEvent: (event, anchor) => {
          const calendarEvent = upcoming.findEvent(event.id);
          if (calendarEvent) {
            calendar.selectEvent(calendarEvent, anchor, 'agenda');
          }
        },
        join: (url) => {
          const target = calendarCallNavigation(url, getWebOrigin());
          if (target.kind === 'internal') navigate(target.path);
          else openExternalUrl(target.url);
        },
      }}
    />
  );
}
