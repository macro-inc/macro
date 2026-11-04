import { calendarSplitRoute } from '@app/routes/routes';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { lazy } from 'solid-js';
import { CalendarViewSkeleton } from './calendar-view-skeleton';

const CalendarView = lazy(async () => ({
  default: (await import('./calendar-view')).CalendarView,
}));

export const CalendarRouteView = withAuth(() => {
  useViewRestoration();
  return <CalendarView route={calendarSplitRoute} />;
}, CalendarViewSkeleton);
