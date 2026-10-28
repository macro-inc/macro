import { openCalendarView } from '@app/features/calendar-view/calendar-navigation';
import {
  calendarSearch,
  calendarSearchTarget,
  calendarTargetSearch,
} from '@app/features/calendar-view/calendar-url';
import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import type { CalendarPreviewSelection } from '@app/features/next-soup/utils';
import {
  createSearchParams,
  type SerializedSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { homeCalendarRoute } from '@app/routes/routes';
import { globalSplitManager } from '@app/signal/splitLayout';
import { previewCalendarTarget } from '@components/app/previewTarget';
import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import deepEqual from 'fast-deep-equal';
import { createSignal } from 'solid-js';
import { homeCalendarNavigation } from './home-preview-navigation';

type WithTab = (
  search: Record<string, SerializedSearchParams | undefined>
) => Record<string, SerializedSearchParams | undefined>;

/** Owns Home's inline Calendar location and repeat-click event refocus. */
export function useHomeCalendarPreview(withTab: WithTab) {
  const navigate = useNavigate();
  const calendarParams = useRouteParams(homeCalendarRoute);
  const [openCalendarSearch] = createSearchParams(calendarSearch);
  const [calendarRefocus, setCalendarRefocus] = createSignal(0);
  const calendarOpen = () => typeof calendarParams.period === 'string';

  const openCalendarEvent = (
    entity: CalendarPreviewSelection,
    options: { activate?: boolean } = {}
  ) => {
    if (!isFeatureEnabled(enableCalendarUi)) return false;
    const calendarTarget = previewCalendarTarget(entity);
    const navigation = homeCalendarNavigation(calendarTarget);
    if (!navigation) return false;
    const span = Telemetry.span('calendar.open_from_home');
    try {
      if (calendarTarget.eventId) {
        span.setAttr('calendar.event_id', calendarTarget.eventId);
      }
      // Home's own calendar keeps the event while it is open, as Home's preview
      // does for a document it already shows. Otherwise a Calendar already open
      // in another split takes it, as it does from the notifications panel,
      // instead of a second calendar in Home.
      if (
        !calendarOpen() &&
        globalSplitManager()?.getSplitByContent('component', CALENDAR_VIEW_ID)
      ) {
        openCalendarView(calendarTarget, {
          activate: options.activate ?? false,
          referredFrom: 'home',
        });
        span.setAttr('calendar.destination', 'calendar_split');
        return true;
      }
      const alreadyOpen =
        calendarOpen() &&
        calendarParams.period === navigation.params.period &&
        deepEqual(
          calendarTargetSearch(calendarTarget),
          calendarTargetSearch(calendarSearchTarget(openCalendarSearch))
        );
      // The same URL still needs to refocus the event in the inline calendar.
      if (alreadyOpen) {
        setCalendarRefocus((count) => count + 1);
        span.setAttr('calendar.destination', 'home_refocus');
      } else {
        fireAndForget(
          navigate(
            { route: homeCalendarRoute, params: navigation.params },
            { search: withTab(navigation.search) }
          ),
          'home-view'
        );
        span.setAttr('calendar.destination', 'home_calendar');
      }
      return true;
    } finally {
      span.end();
    }
  };

  return { calendarOpen, calendarRefocus, openCalendarEvent };
}
