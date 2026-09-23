import { defineRoute } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';
import {
  CALENDAR_ROUTE_ID,
  CALENDAR_SEARCH_NAMESPACE,
  calendarPeriodParams,
  calendarPeriodPath,
} from './calendar-url';
import { CALENDAR_VIEW_ID } from './types';

const CalendarView = lazy(async () => ({
  default: (await import('./calendar-view')).CalendarView,
}));

export const CalendarRouteView = withAuth(() => <CalendarView />);

export const calendarSplitRoute = defineRoute({
  id: CALENDAR_ROUTE_ID,
  path: 'calendar/:period',
  params: calendarPeriodParams,
  serializeParams: ({ period }) => ({
    period: calendarPeriodPath(period),
  }),
  search: [CALENDAR_SEARCH_NAMESPACE],
  externalSearch: ['eventId'],
  component: CalendarRouteView,
  claim: () => ({ namespace: 'component', id: CALENDAR_VIEW_ID }),
});
