import { calendarSplitRoute } from '@app/routes/routes';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { CalendarView } from './calendar-view';
import { CalendarViewSkeleton } from './calendar-view-skeleton';

// The view loads with this module, so preloading the route loads all of it.
export const CalendarRouteView = withAuth(() => {
  useViewRestoration();
  return <CalendarView route={calendarSplitRoute} />;
}, CalendarViewSkeleton);
