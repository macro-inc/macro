import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { t } from '@app/lib/i18n';
import { useNavigate, usePaneHistory } from '@app/lib/split-router';
import { calendarSplitRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { onMount, Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { CalendarViewSkeleton } from './calendar-view-skeleton';
import { MobileCalendarSearchPage } from './views/mobile/calendar-search-page';

function DesktopSearchRedirect() {
  const navigate = useNavigate();
  onMount(() =>
    fireAndForget(
      navigate(
        {
          route: calendarSplitRoute,
          params: { period: getPreferredCalendarPeriodView() },
        },
        { replace: true }
      ),
      'calendar-search-desktop'
    )
  );
  return null;
}
function CalendarSearchPage() {
  useViewRestoration();
  useSplitDisplayName(() => t('calendar.searchPageTitle'));
  const navigate = useNavigate();
  const history = usePaneHistory();
  const back = () => {
    if ((history()?.index ?? 0) > 0) {
      fireAndForget(navigate(-1), 'calendar-search-back');
      return;
    }
    fireAndForget(
      navigate({
        route: calendarSplitRoute,
        params: { period: getPreferredCalendarPeriodView() },
      }),
      'calendar-search-back'
    );
  };
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <Show when={isTouchDevice()} fallback={<DesktopSearchRedirect />}>
          <CalendarFocusContextProvider>
            <CalendarViewContextProvider>
              <MobileCalendarSearchPage onBack={back} />
            </CalendarViewContextProvider>
          </CalendarFocusContextProvider>
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

export const CalendarSearchRouteView = withAuth(
  CalendarSearchPage,
  CalendarViewSkeleton
);
