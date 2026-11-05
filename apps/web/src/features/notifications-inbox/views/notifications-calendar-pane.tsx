import { calendarSearch } from '@app/features/calendar-view/calendar-url';
import { createSearchParams } from '@app/lib/split-router';
import { notificationsCalendarRoute } from '@app/routes/routes';
import { PreviewFrame } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazyNamed } from '@core/util/lazyNamed';
import { Show } from 'solid-js';
import { NotificationsBreadcrumb } from '../components/notifications-breadcrumb';
import { useNotificationsCalendarPane } from '../context/notifications-calendar-context';

// The calendar grid (FullCalendar) only loads once a calendar notification opens.
const CalendarView = lazyNamed(
  () => import('@app/features/calendar-view/calendar-view'),
  'CalendarView'
);

/**
 * The Calendar view aimed at a notification's event, in the notifications
 * view's content area, as other notifications show there.
 */
export function NotificationsCalendarPane() {
  const panel = useSplitPanelOrThrow();
  const calendar = useNotificationsCalendarPane();
  const [search] = createSearchParams(calendarSearch);

  return (
    <div class="flex size-full min-h-0">
      <PreviewFrame
        splitPanelContext={panel}
        headerLeading={<NotificationsBreadcrumb onReturn={calendar.onReturn} />}
        hideHeader={!isTouchDevice()}
        locationKey={() => `${search.eventId}:${search.occurrenceKey}`}
      >
        <CalendarView
          route={notificationsCalendarRoute}
          refocus={calendar.refocus}
          headerLeading={
            <Show when={!isTouchDevice()}>
              <NotificationsBreadcrumb onReturn={calendar.onReturn} />
            </Show>
          }
        />
      </PreviewFrame>
    </div>
  );
}
