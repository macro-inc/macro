import { isSafeName } from '../utils';
import { leafNode, resolveBranch, type SplitRoutesManifest } from './manifest';
import type {
  Entry,
  InferSplitRouteState,
  SplitRouteClaim,
  SplitRouteDefinition,
  SplitRouteParams,
  SplitRouteState,
  SplitSearchState,
} from './types';

/** Params of the first `depth` matches, with descendants overriding ancestors. */
export function routeParams<
  TParams extends SplitRouteParams = SplitRouteParams,
>(route: SplitRouteState | undefined, depth = route?.matches.length): TParams {
  const matches = route?.matches.slice(0, depth) ?? [];
  const params = matches.map((match) => match.params);

  return Object.assign({}, ...params) as TParams;
}

function claimKey(claim: SplitRouteClaim): string {
  return `${claim.namespace}:${claim.id}`;
}

function assertValidClaim(claim: SplitRouteClaim): void {
  const valid = isSafeName(claim.namespace) && claim.id.length > 0;

  if (!valid) {
    throw new Error('Split route returned an invalid claim');
  }
}

/** The deepest claim along the branch; an undefined child claim falls back to ancestors. */
export function claimOf(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): string | undefined {
  const branch = resolveBranch(routes, route);
  const params = routeParams(route);

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const claim = branch[index]!.definition.claim?.(params);
    if (!claim) continue;

    assertValidClaim(claim);

    return claimKey(claim);
  }
}

type RouteStateResult = { success: true; value: unknown } | { success: false };

export function parseRouteEntryState(
  routes: SplitRoutesManifest,
  route: SplitRouteState,
  state: unknown
): RouteStateResult {
  if (state === undefined) return { success: true, value: undefined };

  const schema = leafNode(routes, route).state;
  if (!schema) return { success: false };

  const result = schema['~standard'].validate(state);

  if (result instanceof Promise) {
    throw new Error('Split route state schemas must be synchronous');
  }

  if (result.issues) return { success: false };

  return { success: true, value: result.value };
}

/** State of `entry` when `route` is part of its branch and shares its state schema. */
export function getRouteEntryState<const TRoute extends { id: string }>(
  routes: SplitRoutesManifest,
  entry: Entry | undefined,
  route: TRoute
): InferSplitRouteState<TRoute> | undefined {
  if (!entry) return;

  const leaf = leafNode(routes, entry.location.route);
  const requested = routes.byId.get(route.id);
  if (!requested) return;

  const sharesState =
    leaf.branch.includes(requested) && requested.state === leaf.state;
  if (!sharesState) return;

  return entry.state as InferSplitRouteState<TRoute> | undefined;
}

export function ownsNamespace(
  routes: SplitRoutesManifest,
  route: SplitRouteState,
  namespace: string
): boolean {
  const owned = leafNode(routes, route).search;

  return owned === 'any' || owned.includes(namespace);
}

function pickNamespaces(
  search: SplitSearchState,
  namespaces: readonly string[]
): SplitSearchState {
  const kept = Object.entries(search).filter(([namespace]) =>
    namespaces.includes(namespace)
  );

  return Object.fromEntries(kept);
}

export function filterRouteSearch(
  routes: SplitRoutesManifest,
  route: SplitRouteState,
  search: SplitSearchState | undefined
): SplitSearchState | undefined {
  if (!search) return;

  const owned = leafNode(routes, route).search;
  const kept = owned === 'any' ? search : pickNamespaces(search, owned);
  if (Object.keys(kept).length === 0) return;

  return kept;
}

function definitionExternalKeys(
  definition: SplitRouteDefinition,
  entry: Entry
): readonly string[] {
  const externalSearch = definition.externalSearch;
  if (typeof externalSearch === 'function') return externalSearch(entry);
  if (externalSearch === '*') return [];

  return externalSearch ?? [];
}

/** Whether a shown route keeps every unprefixed query key, as `externalSearch: '*'` asks. */
export function keepsAllExternalSearch(
  routes: SplitRoutesManifest,
  entries: readonly Entry[]
): boolean {
  return entries.some((entry) => {
    const definitions = leafNode(routes, entry.location.route).externalSearch;

    return definitions.some(({ externalSearch }) => externalSearch === '*');
  });
}

function appendMissing(keys: string[], additions: readonly string[]): void {
  for (const key of additions) {
    if (!keys.includes(key)) keys.push(key);
  }
}

/** Unprefixed query keys to keep: global keys plus those claimed by shown routes. */
export function externalSearchKeys(
  routes: SplitRoutesManifest,
  entries: readonly Entry[]
): string[] {
  const keys = [...routes.globalSearch];

  for (const entry of entries) {
    const definitions = leafNode(routes, entry.location.route).externalSearch;

    for (const definition of definitions) {
      appendMissing(keys, definitionExternalKeys(definition, entry));
    }
  }

  return keys;
}

/** Identity of the view mounted at each depth; a change remounts that depth and below. */
function renderKeys(routes: SplitRoutesManifest, entry: Entry): string[] {
  const route = entry.location.route;
  const branch = resolveBranch(routes, route);

  return branch.map((node, depth) => {
    const params = route.matches[depth]!.params;
    const context = { entryId: entry.id };
    const remountKey = node.definition.remountKey?.(params, context);

    return JSON.stringify([node.definition.id, remountKey ?? null]);
  });
}

/** First depth whose view changes between two entries, or undefined when none does. */
export function firstChangedDepth(
  routes: SplitRoutesManifest,
  from: Entry,
  to: Entry | undefined
): number | undefined {
  if (!to) return 0;

  const before = renderKeys(routes, from);
  const after = renderKeys(routes, to);
  const length = Math.max(before.length, after.length);

  for (let depth = 0; depth < length; depth += 1) {
    if (before[depth] !== after[depth]) return depth;
  }
}

export type OutletMatch = {
  component: unknown;
  key: string;
  /** Depth the next nested outlet starts from. */
  depth: number;
};

/** The first component at or below `start` in the entry's branch. */
export function outletAt(
  routes: SplitRoutesManifest,
  entry: Entry | undefined,
  start: number
): OutletMatch | undefined {
  if (!entry) return;

  const keys = renderKeys(routes, entry);
  const branch = resolveBranch(routes, entry.location.route);

  for (let depth = start; depth < branch.length; depth += 1) {
    const component = branch[depth]!.definition.component;
    if (typeof component !== 'function') continue;

    return { component, key: keys[depth]!, depth: depth + 1 };
  }
}
