import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import {
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearch,
  calendarSearchCodec,
  calendarSearchTarget,
  calendarTargetSearch,
} from '@app/features/calendar-view/calendar-url';
import type { CalendarPreviewSelection } from '@app/features/next-soup/utils';
import {
  createSearchParams,
  type SerializedSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import {
  notificationsCalendarRoute,
  notificationsRoute,
} from '@app/routes/routes';
import { previewCalendarTarget } from '@components/app/previewTarget';
import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import deepEqual from 'fast-deep-equal';
import { createSignal } from 'solid-js';

/** The rest of the history entry: other search it writes, and whether it replaces. */
export type CalendarPreviewNavigation = {
  search?: Record<string, SerializedSearchParams | undefined>;
  replace?: boolean;
};

/**
 * Shows calendar events in the Notifications view's content area: the
 * Calendar view under the view's own calendar route, aimed at the event.
 * Choosing the shown event again re-aims at it in place.
 */
export function useNotificationsCalendarPreview() {
  const navigate = useNavigate();
  const params = useRouteParams(notificationsCalendarRoute);
  const [openSearch] = createSearchParams(calendarSearch);
  const [refocus, setRefocus] = createSignal(0);
  const isOpen = () => typeof params.period === 'string';

  /** Aim the inline Calendar at the event; false when it can't show it. */
  const open = (
    entity: CalendarPreviewSelection,
    navigation: CalendarPreviewNavigation = {}
  ) => {
    if (!isFeatureEnabled(enableCalendarUi)) return false;
    const target = previewCalendarTarget(entity);
    if (!target.eventId) return false;
    const span = Telemetry.span('calendar.open_from_notifications');
    try {
      span.setAttr('calendar.event_id', target.eventId);
      const search = calendarTargetSearch(target);
      const shown =
        isOpen() &&
        deepEqual(
          search,
          calendarTargetSearch(calendarSearchTarget(openSearch))
        );
      const period = params.period ?? getPreferredCalendarPeriodView();
      if (shown) {
        setRefocus((count) => count + 1);
        span.setAttr('calendar.destination', 'refocus');
        // The Calendar keeps its place; only the row that chose it changes.
        if (navigation.search) {
          fireAndForget(
            navigate(
              { route: notificationsCalendarRoute, params: { period } },
              { replace: navigation.replace, search: navigation.search }
            ),
            'notifications-inbox'
          );
        }
        return true;
      }
      fireAndForget(
        navigate(
          { route: notificationsCalendarRoute, params: { period } },
          {
            replace: navigation.replace,
            search: {
              ...navigation.search,
              [CALENDAR_SEARCH_NAMESPACE]:
                calendarSearchCodec.serialize(search),
            },
          }
        ),
        'notifications-inbox'
      );
      span.setAttr('calendar.destination', 'inline');
      return true;
    } finally {
      span.end();
    }
  };

  /** Leave the inline Calendar, when it is open. */
  const close = (navigation: CalendarPreviewNavigation = {}) => {
    if (!isOpen()) return;
    fireAndForget(
      navigate(
        { route: notificationsRoute, params: {} },
        {
          replace: navigation.replace,
          search: {
            ...navigation.search,
            [CALENDAR_SEARCH_NAMESPACE]: undefined,
          },
        }
      ),
      'notifications-inbox'
    );
  };

  return { open, close, refocus, isOpen };
}
