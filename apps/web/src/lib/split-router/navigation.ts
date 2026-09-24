import {
  decodeRoute,
  encodeRoute,
  findRouteBranch,
  getRouteId,
  type SplitRoutesManifest,
} from './routes';
import { parseSplitSearch } from './search';
import type {
  SplitLocation,
  SplitNavigateTo,
  SplitRouteParams,
  SplitRouterEntry,
  SplitRouteState,
} from './types';
import { parseExternalLocation, parseRoutePathname } from './url';

function resolveRouteTarget(
  routes: SplitRoutesManifest,
  current: SplitRouterEntry,
  target: { route: { id: string }; params?: unknown }
): SplitRouterEntry | undefined {
  const routeId = target.route.id;
  let targetParams: SplitRouteParams = {};
  if (
    target.params &&
    typeof target.params === 'object' &&
    !Array.isArray(target.params)
  ) {
    targetParams = target.params as SplitRouteParams;
  }
  const branch = findRouteBranch(routes, routeId);
  if (!branch) return;

  const currentMatches = current.location.route.matches;
  const matches = branch.map(({ definition }, index) => {
    const currentMatch = currentMatches[index];
    let params: SplitRouteParams = {};
    if (currentMatch?.id === definition.id) params = currentMatch.params;

    return {
      id: definition.id,
      // Explicit branch params override inherited values at every level before
      // each node serializes its own schema output into path segments.
      params: { ...params, ...targetParams },
    };
  });

  const [first, ...rest] = matches;
  if (!first) return;

  const route: SplitRouteState = { matches: [first, ...rest] };
  return decodeRoute(routes, encodeRoute(routes, { location: { route } }));
}

function resolveParentTarget(
  routes: SplitRoutesManifest,
  current: SplitRouterEntry,
  levels: number | undefined
): SplitRouterEntry | undefined {
  const route = current.location.route;
  if (route.matches.length === 1) return;

  const count = levels ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) return;

  const length = Math.max(1, route.matches.length - count);
  const [first, ...rest] = route.matches.slice(0, length);
  if (!first) return;

  const parentRoute: SplitRouteState = { matches: [first, ...rest] };
  return decodeRoute(
    routes,
    encodeRoute(routes, { location: { route: parentRoute } })
  );
}

function resolvePathTarget(
  routes: SplitRoutesManifest,
  current: SplitRouterEntry,
  to: string
):
  | {
      entry: SplitRouterEntry;
      explicitSearch: SplitLocation['search'];
    }
  | undefined {
  const childRelative = to.startsWith('./');
  let value = to;
  if (childRelative) value = to.slice(2);

  let pathname = value;
  if (!value.startsWith('/')) pathname = `/${value}`;
  const targetUrl = parseExternalLocation(pathname);
  const requested = parseRoutePathname(routes, targetUrl.pathname);

  if (!requested) return;

  let segments: string[];
  if (value.startsWith('/')) {
    segments = requested;
  } else if (childRelative) {
    segments = [...encodeRoute(routes, current), ...requested];
  } else if (requested.length > 0) {
    segments = [encodeRoute(routes, current)[0]!, ...requested];
  } else {
    segments = encodeRoute(routes, current);
  }

  const entry = decodeRoute(routes, segments);
  if (!entry) return;

  return {
    entry,
    explicitSearch: parseSplitSearch(targetUrl.search).get(0),
  };
}

export function resolveNavigation(
  routes: SplitRoutesManifest,
  current: SplitRouterEntry,
  target: SplitRouterEntry | undefined,
  to: Exclude<SplitNavigateTo, number>
): SplitRouterEntry | undefined {
  let resolved:
    | {
        entry: SplitRouterEntry | undefined;
        explicitSearch: SplitLocation['search'];
      }
    | undefined;
  if (typeof to === 'string') {
    resolved = resolvePathTarget(routes, current, to);
  } else if ('route' in to) {
    resolved = {
      entry: resolveRouteTarget(routes, current, to),
      explicitSearch: undefined,
    };
  } else {
    resolved = {
      entry: resolveParentTarget(routes, current, to.levels),
      explicitSearch: undefined,
    };
  }
  if (!resolved) return;
  const decoded = resolved.entry;
  if (!decoded) return;

  let search = resolved.explicitSearch;
  if (!search && target && getRouteId(target) === getRouteId(decoded)) {
    search = target.location.search;
  }

  const location: SplitLocation = { ...decoded.location };
  if (search) location.search = search;
  return { location };
}
