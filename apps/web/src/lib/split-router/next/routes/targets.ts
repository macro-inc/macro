import { isRecord } from '../utils';
import {
  canonicalRoute,
  decodePane,
  formatPane,
  type SplitRoutesManifest,
} from './manifest';
import { decodeSegment } from './path';
import { filterRouteSearch } from './queries';
import { locationOf, parsePaneSearch, updateSearchState } from './search';
import type {
  SplitLocation,
  SplitNavigationTarget,
  SplitRouteMatch,
  SplitRouteParams,
  SplitRouteState,
  SplitSearchState,
  SplitSearchUpdate,
} from './types';

type ResolveTargetOptions = {
  /**
   * Leading matches that belong to the calling route. Relative paths resolve
   * against their path; defaults to the whole current branch.
   */
  depth?: number;
  search?: Readonly<Record<string, SplitSearchUpdate>>;
};

type ResolvedRoute = { route: SplitRouteState; search?: SplitSearchState };

function splitTarget(to: string): { path: string; search: string } {
  const hash = to.indexOf('#');
  const withoutHash = hash >= 0 ? to.slice(0, hash) : to;
  const query = withoutHash.indexOf('?');
  if (query < 0) return { path: withoutHash, search: '' };

  return {
    path: withoutHash.slice(0, query),
    search: withoutHash.slice(query),
  };
}

function routeState(matches: readonly SplitRouteMatch[]): SplitRouteState {
  const [first, ...rest] = matches;

  return { matches: [first!, ...rest] };
}

function formatMatches(
  routes: SplitRoutesManifest,
  matches: readonly SplitRouteMatch[]
): string[] {
  if (matches.length === 0) return [];

  return formatPane(routes, routeState(matches));
}

function baseSegments(
  routes: SplitRoutesManifest,
  current: SplitLocation | undefined,
  depth: number | undefined
): string[] {
  if (!current) return [];

  const matches = current.route.matches;

  return formatMatches(routes, matches.slice(0, depth ?? matches.length));
}

function walkPath(base: readonly string[], path: string): string[] {
  const segments = [...base];

  for (const part of path.split('/')) {
    const ignored = part === '' || part === '.';
    if (ignored) continue;

    if (part === '..') {
      segments.pop();
      continue;
    }

    segments.push(decodeSegment(part));
  }

  return segments;
}

function resolvePath(
  routes: SplitRoutesManifest,
  current: SplitLocation | undefined,
  to: string,
  depth: number | undefined
): ResolvedRoute | undefined {
  const target = splitTarget(to);
  const absolute = target.path.startsWith('/');
  const base = absolute ? [] : baseSegments(routes, current, depth);
  const segments = walkPath(base, target.path);
  const route = decodePane(routes, segments);
  if (!route) return;

  return { route, search: parsePaneSearch(target.search)[0] };
}

function canonicalTarget(
  routes: SplitRoutesManifest,
  matches: readonly SplitRouteMatch[]
): ResolvedRoute | undefined {
  const route = canonicalRoute(routes, routeState(matches));
  if (!route) return;

  return { route };
}

function inheritedParams(
  match: SplitRouteMatch | undefined,
  id: string
): SplitRouteParams {
  if (match?.id !== id) return {};

  return match.params;
}

function resolveRoute(
  routes: SplitRoutesManifest,
  current: SplitLocation | undefined,
  to: { route: { id: string }; params?: unknown }
): ResolvedRoute | undefined {
  const node = routes.byId.get(to.route.id);
  if (!node) return;

  const explicit = isRecord(to.params) ? to.params : {};
  const currentMatches = current?.route.matches ?? [];
  const matches = node.branch.map((ancestor, index): SplitRouteMatch => {
    const id = ancestor.definition.id;
    const inherited = inheritedParams(currentMatches[index], id);

    // Explicit params override inherited values at every level before each
    // node serializes the fields it owns.
    return { id, params: { ...inherited, ...explicit } };
  });

  return canonicalTarget(routes, matches);
}

function resolveDestination(
  routes: SplitRoutesManifest,
  current: SplitLocation | undefined,
  to: SplitNavigationTarget,
  depth: number | undefined
): ResolvedRoute | undefined {
  if (typeof to === 'string') return resolvePath(routes, current, to, depth);
  if (!('route' in to)) return;

  return resolveRoute(routes, current, to);
}

function carriedSearch(
  current: SplitLocation | undefined,
  resolved: ResolvedRoute
): SplitSearchState | undefined {
  if (resolved.search !== undefined) return resolved.search;
  if (!current) return;

  const sameRoot = current.route.matches[0].id === resolved.route.matches[0].id;
  if (!sameRoot) return;

  return current.search;
}

/**
 * Resolves a target within one pane. Search carries over only while the root
 * route stays the same, and namespaces the destination doesn't own are dropped.
 */
export function resolveTarget(
  routes: SplitRoutesManifest,
  current: SplitLocation | undefined,
  to: SplitNavigationTarget,
  options: ResolveTargetOptions = {}
): SplitLocation | undefined {
  const resolved = resolveDestination(routes, current, to, options.depth);
  if (!resolved) return;

  const search = carriedSearch(current, resolved);
  const start = locationOf(resolved.route, search);
  const updated = updateSearchState(start, options.search);
  const owned = filterRouteSearch(routes, updated.route, updated.search);

  return locationOf(updated.route, owned);
}
