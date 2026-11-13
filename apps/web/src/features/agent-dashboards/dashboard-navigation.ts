import type { SplitLocation } from '@app/lib/split-router';
import { routeParams } from '@app/lib/split-router';
import { paneRootMatch, paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

export const AGENT_DASHBOARD_ROUTE_ID = 'agent-dashboard';
export const DASHBOARD_ROUTE_ID = 'dashboard';

/** An agent account's page, at `agent-accounts/:userId`. */
export function agentDashboardLocation(userId: string): SplitLocation {
  return {
    route: paneRoute({ id: AGENT_DASHBOARD_ROUTE_ID, params: { userId } }),
  };
}

/** A dashboard opened by id, at `dashboard/:dashboardId`. */
export function dashboardLocation(dashboardId: string): SplitLocation {
  return {
    route: paneRoute({ id: DASHBOARD_ROUTE_ID, params: { dashboardId } }),
  };
}

/**
 * The split content a dashboard route opens as: a component that carries its
 * route, so the split layout and restored layouts round-trip to the same URL.
 * Undefined for other routes, and for a dashboard route missing its id.
 */
export function dashboardContentFromLocation(
  location: SplitLocation
): SplitContent | undefined {
  const root = paneRootMatch(location.route);
  if (!root) return undefined;

  const params = routeParams(location.route);
  if (root.id === AGENT_DASHBOARD_ROUTE_ID) {
    const { userId } = params;
    if (typeof userId !== 'string' || userId === '') return undefined;

    return {
      type: 'component',
      id: AGENT_DASHBOARD_ROUTE_ID,
      params: { userId },
      entryMetadata: agentDashboardLocation(userId),
    };
  }

  if (root.id === DASHBOARD_ROUTE_ID) {
    const { dashboardId } = params;
    if (typeof dashboardId !== 'string' || dashboardId === '') return undefined;

    return {
      type: 'component',
      id: DASHBOARD_ROUTE_ID,
      params: { dashboardId },
      entryMetadata: dashboardLocation(dashboardId),
    };
  }

  return undefined;
}

/** The route of dashboard split content (restored or opened outside a route). */
export function dashboardLocationFromContent(
  content: SplitContent
): SplitLocation | undefined {
  if (content.type !== 'component') return undefined;

  const userId = content.params?.userId;
  if (content.id === AGENT_DASHBOARD_ROUTE_ID && typeof userId === 'string') {
    return agentDashboardLocation(userId);
  }

  const dashboardId = content.params?.dashboardId;
  if (content.id === DASHBOARD_ROUTE_ID && typeof dashboardId === 'string') {
    return dashboardLocation(dashboardId);
  }

  return undefined;
}
