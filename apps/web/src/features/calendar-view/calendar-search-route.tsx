import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { calendarSplitRoute } from '@app/routes/routes';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { fireAndForget } from '@core/util/fireAndForget';
import { onMount } from 'solid-js';
import { CalendarViewSkeleton } from './calendar-view-skeleton';
import { CalendarUtilityView } from './views/calendar-utility-view';
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
  return (
    <CalendarUtilityView
      title={t('calendar.searchPageTitle')}
      desktop={<DesktopSearchRedirect />}
    >
      {(back) => <MobileCalendarSearchPage onBack={back} />}
    </CalendarUtilityView>
  );
}

export const CalendarSearchRouteView = withAuth(
  CalendarSearchPage,
  CalendarViewSkeleton
);
