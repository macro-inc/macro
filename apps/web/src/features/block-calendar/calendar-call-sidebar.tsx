import { SidePanel } from '@components/app/side-panel/SidePanel';
import { useUserId } from '@core/context/user';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { useNavigate } from '@solidjs/router';
import { isSameDay, isTomorrow } from 'date-fns';
import { useCalendarView } from '../calendar/components/CalendarViewContext';
import { formatCompactCalendarTime } from '../calendar/utils/time-format';
import { calendarCallNavigation } from '../meetings/core/calendar-calls';
import type { UpcomingCalendarEvent } from '../meetings/core/upcoming-calendar-events';
import { createCallSidebarClock } from '../meetings/primitives/call-sidebar';
import { useActiveQuickCallsSource } from '../meetings/queries/active-quick-calls';
import { useUpcomingCalendarEventsSource } from '../meetings/queries/upcoming-calendar-events';
import { useQuickCallsFlag } from '../meetings/use-quick-calls-flag';
import { CallSidebar } from '../meetings/views/call-sidebar';

export function CalendarCallsSidePanelSection() {
  return (
    <SidePanel.Section
      id="calendar-calls"
      title="Upcoming events"
      order={15}
      defaultOpen
    >
      <CalendarCallSidebar />
    </SidePanel.Section>
  );
}

/** Production wiring, mounted within the section's Suspense boundary. */
function CalendarCallSidebar() {
  const calendar = useCalendarView();
  const userId = useUserId();
  const quickCalls = useQuickCallsFlag();
  const now = createCallSidebarClock();
  const upcoming = useUpcomingCalendarEventsSource({
    userId,
    sourceById: calendar.sourceById,
    isSourceVisible: calendar.isSourceVisible,
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
      actions={{
        openEvent: (event, anchor) => {
          const calendarEvent = upcoming.findEvent(event.id);
          if (calendarEvent)
            calendar.selectEvent(calendarEvent, anchor, 'agenda');
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
