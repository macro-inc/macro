import { createQueryKeys } from '@lukemorales/query-key-factory';

/** Keyed by the viewer first: a dashboard is read with the viewer's access. */
export const agentDashboardKeys = createQueryKeys('agentDashboards', {
  home: (viewerId: string, userId: string) => [viewerId, 'home', userId],
  dashboard: (viewerId: string, dashboardId: string) => [
    viewerId,
    'dashboard',
    dashboardId,
  ],
});
