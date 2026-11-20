import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { CalendarSettings } from '@app/features/calendar/calendar-settings';
import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { useNavigate, usePaneHistory } from '@app/lib/split-router';
import { calendarSplitRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { CalendarFocusContextProvider } from './calendar-focus-target';
import { CalendarViewSkeleton } from './calendar-view-skeleton';
import { MobileCalendarSettingsPage } from './views/mobile/calendar-settings-page';

function CalendarSettingsPage() {
  useViewRestoration();
  useSplitDisplayName(() => 'Calendar settings');
  const navigate = useNavigate();
  const history = usePaneHistory();
  const back = () => {
    if ((history()?.index ?? 0) > 0) {
      fireAndForget(navigate(-1), 'calendar-settings-back');
      return;
    }
    fireAndForget(
      navigate({
        route: calendarSplitRoute,
        params: { period: getPreferredCalendarPeriodView() },
      }),
      'calendar-settings-back'
    );
  };
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <Show when={isTouchDevice()} fallback={<CalendarSettings />}>
          <CalendarFocusContextProvider>
            <CalendarViewContextProvider>
              <MobileCalendarSettingsPage onBack={back} />
            </CalendarViewContextProvider>
          </CalendarFocusContextProvider>
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

export const CalendarSettingsRouteView = withAuth(
  CalendarSettingsPage,
  CalendarViewSkeleton
);
