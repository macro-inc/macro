import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { handleRefreshCalendar } from '@queries/calendar/sync';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { TeamOooUpcomingList } from '../../calendar-view/components/CalendarSidebar';

declare global {
  interface Window {
    calendarFixture: {
      /** Hands the app a `refresh_calendar` frame, as its socket does. */
      refreshCalendar: (payload: unknown) => void;
    };
  }
}
window.calendarFixture = { refreshCalendar: handleRefreshCalendar };
document.documentElement.dataset.touchDevice = String(isTouchDevice());

/** The calendar sidebar's team out-of-office list over the real queries. */
function Fixture() {
  return (
    <QueryClientProvider client={queryClient}>
      <main class="w-72 bg-page p-4 text-ink">
        <h1 class="pb-2 text-sm font-medium">Team out of office</h1>
        <TeamOooUpcomingList />
      </main>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
