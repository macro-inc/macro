import { calendarSplitRoute } from '@app/routes/routes';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';

const CalendarView = lazy(async () => ({
  default: (await import('./calendar-view')).CalendarView,
}));

export const CalendarRouteView = withAuth(() => (
  <CalendarView route={calendarSplitRoute} />
));
