import type { SplitRouteMatch, SplitRouteState } from '@app/split-router';

/** The route without a path whose children are the pane routes. */
export const APP_ROUTE_ID = 'app';

/** The pane route that catches any pane path no other route matches. */
export const NOT_FOUND_ROUTE_ID = 'not-found';

const appMatch: SplitRouteMatch = { id: APP_ROUTE_ID, params: {} };

/** A pane route's state: the app route, then the pane route's own matches. */
export function paneRoute(
  ...matches: [SplitRouteMatch, ...SplitRouteMatch[]]
): SplitRouteState {
  return { matches: [appMatch, ...matches] };
}

/** The first match below the app route, which names what a pane shows. */
export function paneRootMatch(
  route: SplitRouteState
): SplitRouteMatch | undefined {
  const [first, root] = route.matches;
  if (first.id !== APP_ROUTE_ID) return;

  return root;
}
