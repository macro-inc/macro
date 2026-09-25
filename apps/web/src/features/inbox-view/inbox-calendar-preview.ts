import {
  calendarSearch,
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
import { previewCalendarTarget } from '@components/app/previewTarget';
import {
  enableCalendarUi,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import deepEqual from 'fast-deep-equal';
import { createSignal } from 'solid-js';
import { inboxCalendarNavigation } from './inbox-preview-navigation';
import { inboxCalendarRoute } from './route';

type WithTab = (
  search: Record<string, SerializedSearchParams | undefined>
) => Record<string, SerializedSearchParams | undefined>;

/** Owns Home's inline Calendar location and repeat-click event refocus. */
export function useInboxCalendarPreview(withTab: WithTab) {
  const navigate = useNavigate();
  const calendarParams = useRouteParams(inboxCalendarRoute);
  const [openCalendarSearch] = createSearchParams(calendarSearch);
  const [calendarRefocus, setCalendarRefocus] = createSignal(0);
  const calendarOpen = () => typeof calendarParams.period === 'string';

  const openCalendarEvent = (entity: CalendarPreviewSelection) => {
    if (!isFeatureEnabled(enableCalendarUi)) return false;
    const calendarTarget = previewCalendarTarget(entity);
    const navigation = inboxCalendarNavigation(calendarTarget);
    if (!navigation) return false;
    const alreadyOpen =
      calendarOpen() &&
      calendarParams.period === navigation.params.period &&
      deepEqual(
        calendarTargetSearch(calendarTarget),
        calendarTargetSearch(calendarSearchTarget(openCalendarSearch))
      );
    // The same URL still needs to refocus the event in the inline calendar.
    if (alreadyOpen) setCalendarRefocus((count) => count + 1);
    else
      navigate(
        { route: inboxCalendarRoute, params: navigation.params },
        { search: withTab(navigation.search) }
      );
    return true;
  };

  return { calendarOpen, calendarRefocus, openCalendarEvent };
}
