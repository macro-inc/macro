import type { StandardSchemaV1 } from '@standard-schema/spec';
import { isRecord, isSafeName } from '../utils';
import {
  compileRoutePattern,
  formatTokens,
  matchTokens,
  type PathToken,
  patternKey,
  type RoutePattern,
  specificity,
} from './path';
import { assertSafeSearchName } from './search';
import type {
  SplitRouteDefinition,
  SplitRouteMatch,
  SplitRouteParams,
  SplitRouteRawParams,
  SplitRouteState,
  SplitRoutes,
} from './types';

type RouteParamsCodec = {
  parse(params: SplitRouteRawParams): SplitRouteParams | undefined;
  serialize(params: SplitRouteParams): SplitRouteParams;
};

export type SplitRouteNode<TComponent = unknown> = {
  readonly definition: SplitRouteDefinition<TComponent>;
  readonly parent?: SplitRouteNode<TComponent>;
  /** Root to this node, inclusive. */
  readonly branch: readonly SplitRouteNode<TComponent>[];
  readonly children: readonly SplitRouteNode<TComponent>[];
  readonly pattern: RoutePattern;
  readonly params: RouteParamsCodec;
  /** Search namespaces owned through this node; `'any'` when nothing restricts them. */
  readonly search: readonly string[] | 'any';
  readonly state?: StandardSchemaV1;
  readonly externalSearch: readonly SplitRouteDefinition<TComponent>[];
};

type RouteBranch<TComponent = unknown> = {
  readonly nodes: readonly SplitRouteNode<TComponent>[];
  readonly patterns: readonly (readonly PathToken[])[];
  readonly score: number;
  readonly order: number;
};

/** Runtime route state owned by one router, compiled once from static definitions. */
export type SplitRoutesManifest<TComponent = unknown> = {
  readonly byId: ReadonlyMap<string, SplitRouteNode<TComponent>>;
  /** Every root-to-node path, most specific first. */
  readonly branches: readonly RouteBranch<TComponent>[];
  readonly globalSearch: readonly string[];
  readonly defaultRoute: () => SplitRouteState;
};

function validateRouteParams(
  schema: StandardSchemaV1 | undefined,
  params: SplitRouteParams
): SplitRouteParams | undefined {
  if (!schema) return params;

  const result = schema['~standard'].validate(params);

  if (result instanceof Promise) {
    throw new Error('Split route parameter schemas must be synchronous');
  }

  if (result.issues) return;

  if (!isRecord(result.value)) {
    throw new Error('Split route parameter schemas must return an object');
  }

  return result.value;
}

function createParamsCodec(definition: SplitRouteDefinition): RouteParamsCodec {
  const schema = definition.params;
  const serialize = definition.serializeParams?.bind(definition);

  return {
    parse: (params) => validateRouteParams(schema, params),
    // Without a custom serializer, the pattern formats its primitive fields.
    serialize: (params) => serialize?.(params) ?? params,
  };
}

function ownNamespaces(search: readonly string[] | undefined): string[] {
  const own: string[] = [];

  for (const namespace of search ?? []) {
    assertSafeSearchName(namespace, 'namespace');

    if (own.includes(namespace)) {
      throw new Error(`Duplicate split route search namespace "${namespace}"`);
    }

    own.push(namespace);
  }

  return own;
}

/** A route without a path that lists no namespaces leaves the choice to its children. */
function searchParent(
  parent: SplitRouteNode | undefined
): SplitRouteNode | undefined {
  let node = parent;
  while (node && isLayoutRoute(node) && node.definition.search === undefined) {
    node = node.parent;
  }

  return node;
}

function branchSearch(
  enclosing: SplitRouteNode | undefined,
  search: readonly string[] | '*' | undefined
): readonly string[] | 'any' {
  if (search === '*') return 'any';

  const own = ownNamespaces(search);
  const parent = searchParent(enclosing);
  if (!parent) return search === undefined ? 'any' : own;
  if (parent.search === 'any') return 'any';

  const inherited = parent.search;
  const added = own.filter((name) => !inherited.includes(name));

  return [...inherited, ...added];
}

/** A route without a path groups its children; only they can be matched. */
const isLayoutRoute = (node: SplitRouteNode) =>
  node.definition.path === undefined;

function collectBranches<TComponent>(
  branches: RouteBranch<TComponent>[],
  node: SplitRouteNode<TComponent>,
  nodes: readonly SplitRouteNode<TComponent>[],
  patterns: readonly (readonly PathToken[])[]
): void {
  for (const tokens of node.pattern.alternatives) {
    const branchNodes = [...nodes, node];
    const branchPatterns = [...patterns, tokens];

    if (!isLayoutRoute(node as SplitRouteNode)) {
      branches.push({
        nodes: branchNodes,
        patterns: branchPatterns,
        score: specificity(branchPatterns.flat()),
        order: branches.length,
      });
    }

    for (const child of node.children) {
      collectBranches(branches, child, branchNodes, branchPatterns);
    }
  }
}

function bySpecificity(left: RouteBranch, right: RouteBranch): number {
  return right.score - left.score || left.order - right.order;
}

function compileBranches<TComponent>(
  roots: readonly SplitRouteNode<TComponent>[]
): RouteBranch<TComponent>[] {
  const branches: RouteBranch<TComponent>[] = [];

  for (const root of roots) collectBranches(branches, root, [], []);

  return branches.sort(bySpecificity);
}

function assertGlobalSearch(keys: readonly string[]): void {
  for (const key of keys) {
    if (!isSafeName(key)) {
      throw new Error(`Invalid global search key "${key}"`);
    }
  }
}

function assertNewRouteId(
  byId: ReadonlyMap<string, unknown>,
  id: string
): void {
  if (!isSafeName(id)) {
    throw new Error(`Invalid split route id "${id}"`);
  }

  if (byId.has(id)) {
    throw new Error(`Duplicate split route id "${id}"`);
  }
}

function claimSiblingPaths(
  siblingPaths: string[],
  definition: Pick<SplitRouteDefinition, 'path' | 'aliases'>
): void {
  if (definition.path === undefined) return;

  const paths = [definition.path, ...(definition.aliases ?? [])];

  for (const path of paths) {
    const key = patternKey(path);

    if (siblingPaths.includes(key)) {
      throw new Error(`Duplicate sibling split route path "${key}"`);
    }

    siblingPaths.push(key);
  }
}

function createNode<TComponent>(
  definition: SplitRouteDefinition<TComponent>,
  parent: SplitRouteNode<TComponent> | undefined,
  children: readonly SplitRouteNode<TComponent>[]
): SplitRouteNode<TComponent> {
  const branch: SplitRouteNode<TComponent>[] = [...(parent?.branch ?? [])];
  const ownExternalSearch = definition.externalSearch ? [definition] : [];
  const node: SplitRouteNode<TComponent> = {
    definition,
    parent,
    branch,
    children,
    pattern: compileRoutePattern(definition),
    params: createParamsCodec(definition as SplitRouteDefinition),
    search: branchSearch(
      parent as SplitRouteNode | undefined,
      definition.search
    ),
    state: definition.state ?? parent?.state,
    externalSearch: [...(parent?.externalSearch ?? []), ...ownExternalSearch],
  };

  branch.push(node);

  return node;
}

function assertLayoutHasChildren(definition: SplitRouteDefinition): void {
  const isLayout = definition.path === undefined;
  const hasChildren = (definition.children?.length ?? 0) > 0;
  if (!isLayout || hasChildren) return;

  throw new Error(
    `Split route "${definition.id}" has no path, so it needs children`
  );
}

/** Children of a route without a path sit beside its siblings, so they share sibling paths. */
function compileNodes<TComponent>(
  byId: Map<string, SplitRouteNode<TComponent>>,
  definitions: readonly SplitRouteDefinition<TComponent>[],
  parent?: SplitRouteNode<TComponent>,
  siblingPaths: string[] = []
): SplitRouteNode<TComponent>[] {
  return definitions.map((definition) => {
    assertNewRouteId(byId, definition.id);
    assertLayoutHasChildren(definition as SplitRouteDefinition);
    claimSiblingPaths(siblingPaths, definition);

    const children: SplitRouteNode<TComponent>[] = [];
    const node = createNode(definition, parent, children);
    byId.set(definition.id, node);

    const isLayout = definition.path === undefined;
    const childSiblings = isLayout ? siblingPaths : [];
    const childDefinitions = definition.children ?? [];
    children.push(...compileNodes(byId, childDefinitions, node, childSiblings));

    return node;
  });
}

/** Compile static definitions into independent, caller-owned runtime state. */
export function createRoutesManifest<TComponent>(
  routes: SplitRoutes<TComponent>
): SplitRoutesManifest<TComponent> {
  const globalSearch = routes.globalSearch ?? [];
  assertGlobalSearch(globalSearch);

  const byId = new Map<string, SplitRouteNode<TComponent>>();
  const roots = compileNodes(byId, routes.definitions);

  return {
    byId,
    branches: compileBranches(roots),
    globalSearch,
    defaultRoute: routes.defaultRoute,
  };
}

function matchBranch(
  branch: RouteBranch,
  segments: readonly string[]
): SplitRouteState | undefined {
  const matches: SplitRouteMatch[] = [];
  let offset = 0;

  for (const [depth, node] of branch.nodes.entries()) {
    const raw = matchTokens(branch.patterns[depth]!, segments, offset);
    if (!raw) return;

    const params = node.params.parse(raw.params);
    if (!params) return;

    matches.push({ id: node.definition.id, params });
    offset = raw.end;
  }

  const matchedEverySegment = offset === segments.length;
  if (!matchedEverySegment) return;

  return { matches: matches as [SplitRouteMatch, ...SplitRouteMatch[]] };
}

function decodeAmong(
  branches: readonly RouteBranch[],
  segments: readonly string[]
): SplitRouteState | undefined {
  for (const branch of branches) {
    const route = matchBranch(branch, segments);
    if (route) return route;
  }
}

/** The most specific route for one pane's decoded segments. */
export function decodePane(
  routes: SplitRoutesManifest,
  segments: readonly string[]
): SplitRouteState | undefined {
  return decodeAmong(routes.branches, segments);
}

/** A splat nested in another route, like an in-pane not-found; it can't pick a URL's top-level route. */
function isNestedCatchAll(branch: RouteBranch): boolean {
  if (branch.nodes.length < 2) return false;

  const tokens = branch.patterns.flat();

  return tokens.length === 1 && tokens[0]!.type === 'catchAll';
}

/** The first pane picks the URL's top-level route. */
export function decodeFirstPane(
  routes: SplitRoutesManifest,
  segments: readonly string[]
): SplitRouteState | undefined {
  const deciding = routes.branches.filter(
    (branch) => !isNestedCatchAll(branch)
  );

  return decodeAmong(deciding, segments);
}

function isNonemptyBranch(value: unknown): value is { matches: unknown[] } {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.matches)) return false;

  return value.matches.length > 0;
}

function isRouteMatch(value: unknown): value is SplitRouteMatch {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;

  return isRecord(value.params);
}

/** Validate host or persisted state without treating schema outputs as schema inputs. */
function assertRouteState(
  routes: SplitRoutesManifest,
  route: unknown
): asserts route is SplitRouteState {
  if (!isNonemptyBranch(route)) {
    throw new Error('Split route state requires a nonempty match branch');
  }

  let parent: SplitRouteNode | undefined;

  for (const match of route.matches) {
    if (!isRouteMatch(match)) {
      throw new Error('Split route state contains an invalid match');
    }

    const node = routes.byId.get(match.id);
    const continuesBranch = node !== undefined && node.parent === parent;

    if (!continuesBranch) {
      throw new Error('Split route state contains an invalid match branch');
    }

    parent = node;
  }
}

function isBranchOf<TComponent>(
  nodes: readonly SplitRouteNode<TComponent>[],
  route: SplitRouteState
): boolean {
  if (nodes.length !== route.matches.length) return false;

  return nodes.every(
    (node, index) => node.definition.id === route.matches[index]!.id
  );
}

function sameMatchIds(left: SplitRouteState, right: SplitRouteState): boolean {
  if (left.matches.length !== right.matches.length) return false;

  return left.matches.every(
    (match, index) => match.id === right.matches[index]!.id
  );
}

export function resolveBranch<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState
): readonly SplitRouteNode<TComponent>[] {
  const leaf = route.matches[route.matches.length - 1]!;
  const branch = routes.byId.get(leaf.id)?.branch ?? [];

  if (!isBranchOf(branch, route)) {
    throw new Error('Split route state contains an invalid match branch');
  }

  return branch;
}

/** The deepest node of a route: the one that owns search, state and external keys. */
export function leafNode<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState
): SplitRouteNode<TComponent> {
  const branch = resolveBranch(routes, route);

  return branch[branch.length - 1]!;
}

/** The first route with a path; a pane's search carries over while it stays the same. */
export function searchRootId(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): string {
  const branch = resolveBranch(routes, route);
  const index = branch.findIndex((node) => !isLayoutRoute(node));

  return route.matches[Math.max(index, 0)]!.id;
}

export function defaultRoute(routes: SplitRoutesManifest): SplitRouteState {
  const route = routes.defaultRoute();
  assertRouteState(routes, route);

  return route;
}

/** Decoded path segments of a pane, always using canonical paths. */
export function formatPane(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): string[] {
  const branch = resolveBranch(routes, route);

  return branch.flatMap((node, index) => {
    const params = node.params.serialize(route.matches[index]!.params);

    return formatTokens(node.pattern.canonical, params);
  });
}

/**
 * Round-trip a route through its canonical path so schemas see raw inputs.
 * Undefined when the path resolves to a different branch.
 */
export function canonicalRoute(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): SplitRouteState | undefined {
  const segments = formatPane(routes, route);
  const decoded = decodePane(routes, segments);
  if (!decoded) return;
  if (!sameMatchIds(decoded, route)) return;

  return decoded;
}
