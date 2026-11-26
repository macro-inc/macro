import { CalendarSettings } from '@app/features/calendar/calendar-settings';
import { t } from '@app/lib/i18n';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { CalendarViewSkeleton } from './calendar-view-skeleton';
import { CalendarUtilityView } from './views/calendar-utility-view';
import { MobileCalendarSettingsPage } from './views/mobile/calendar-settings-page';

function CalendarSettingsPage() {
  return (
    <CalendarUtilityView
      title={t('calendar.settingsTitle')}
      desktop={<CalendarSettings />}
    >
      {(back) => <MobileCalendarSettingsPage onBack={back} />}
    </CalendarUtilityView>
  );
}

export const CalendarSettingsRouteView = withAuth(
  CalendarSettingsPage,
  CalendarViewSkeleton
);
