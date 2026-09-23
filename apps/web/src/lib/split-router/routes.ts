import type { StandardSchemaV1 } from '@standard-schema/spec';
import { compileRoutePattern, type RoutePattern } from './path';
import { assertSafeSearchName } from './search';
import type {
  DefinedSplitRoute,
  DefinedSplitRoutes,
  InferSplitRouteParams,
  InferSplitRoutePathParams,
  SplitRouteClaim,
  SplitRouteDefinition,
  SplitRouteMatch,
  SplitRouteParams,
  SplitRouteRawParams,
  SplitRouterEntry,
  SplitRouteState,
  SplitRoutes,
  SplitSearchState,
  UnmatchedSplitPathHandler,
} from './types';
import { isRecord, isSafeName, takeLast } from './utils';

type SplitRouteDefinitionConstraint = {
  id: string;
  path: string;
  aliases?: readonly string[];
  component?: unknown;
  children?: readonly SplitRouteDefinitionConstraint[];
  params?: StandardSchemaV1;
  serializeParams?: unknown;
  claim?: unknown;
  search?: readonly string[] | '*';
  externalSearch?: SplitRouteDefinition['externalSearch'];
  remountKey?: unknown;
};

type RouteParamCallbacks<TParams> = {
  serializeParams?: (params: TParams) => SplitRouteRawParams;
  claim?: (params: TParams) => SplitRouteClaim | undefined;
  remountKey?: (params: TParams) => string | number | undefined;
};

type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

// Schemas may narrow or coerce raw string values. The declaration boundary
// therefore compares parameter names and requiredness, not value domains.
type CompatibleSchemaInputs<TPathParams, TSchemaInput> =
  TSchemaInput extends unknown
    ? Exclude<keyof TPathParams, keyof TSchemaInput> extends never
      ? Exclude<
          RequiredKeys<TPathParams>,
          RequiredKeys<TSchemaInput>
        > extends never
        ? Exclude<
            RequiredKeys<TSchemaInput>,
            RequiredKeys<TPathParams>
          > extends never
          ? TSchemaInput
          : never
        : never
      : never
    : never;

type InvalidSchemaPathParams<TPathParams, TSchemaInput> =
  TPathParams extends unknown
    ? [CompatibleSchemaInputs<TPathParams, TSchemaInput>] extends [never]
      ? TPathParams
      : never
    : never;

type RouteParamsSchemaIssue<
  TPath extends string,
  TAliases extends readonly string[] | undefined,
  TSchema extends StandardSchemaV1,
> =
  InferSplitRoutePathParams<TPath, TAliases> extends infer TPathParams
    ? InvalidSchemaPathParams<
        TPathParams,
        StandardSchemaV1.InferInput<TSchema>
      > extends infer TInvalidPathParams
      ? [TInvalidPathParams] extends [never]
        ? never
        : {
            path: TPath;
            aliases: TAliases;
            pathParams: TPathParams;
            schemaInput: StandardSchemaV1.InferInput<TSchema>;
            missingSchemaKeys: Exclude<
              KeysOfUnion<TPathParams>,
              KeysOfUnion<StandardSchemaV1.InferInput<TSchema>>
            >;
            incompatiblePathParams: TInvalidPathParams;
          }
      : never
    : never;

type RouteParamsSchemaConstraint<
  TPath extends string,
  TAliases extends readonly string[] | undefined,
  TSchema extends StandardSchemaV1,
> = [RouteParamsSchemaIssue<TPath, TAliases, TSchema>] extends [never]
  ? unknown
  : {
      readonly 'ERROR: params schema keys and optionality must match path and aliases': RouteParamsSchemaIssue<
        TPath,
        TAliases,
        TSchema
      >;
    };

type DefinitionAliases<TDefinition> = TDefinition extends {
  aliases: infer TAliases extends readonly string[];
}
  ? TAliases
  : undefined;

type SplitRouteDefinitionRemainder = Omit<
  SplitRouteDefinitionConstraint,
  'path' | 'params'
>;

type RouteDefinitionParamsSchemaIssues<TDefinition> =
  | (TDefinition extends {
      id: infer TId;
      path: infer TPath extends string;
      params: infer TSchema extends StandardSchemaV1;
    }
      ? RouteParamsSchemaIssue<
          TPath,
          DefinitionAliases<TDefinition>,
          TSchema
        > extends infer TIssue
        ? [TIssue] extends [never]
          ? never
          : TIssue & { routeId: TId }
        : never
      : never)
  | (TDefinition extends {
      children: infer TChildren extends readonly unknown[];
    }
      ? RouteDefinitionsParamsSchemaIssues<TChildren>
      : never);

type RouteDefinitionsParamsSchemaIssues<
  TDefinitions extends readonly unknown[],
> = TDefinitions[number] extends infer TDefinition
  ? RouteDefinitionParamsSchemaIssues<TDefinition>
  : never;

type RouteDefinitionsParamsSchemaConstraint<
  TDefinitions extends readonly unknown[],
> = [RouteDefinitionsParamsSchemaIssues<TDefinitions>] extends [never]
  ? unknown
  : {
      readonly 'ERROR: route params schema keys and optionality must match paths and aliases': RouteDefinitionsParamsSchemaIssues<TDefinitions>;
    };

export function defineRoute<
  const TPath extends string,
  const TAliases extends readonly string[] | undefined,
  const TDefinition extends SplitRouteDefinitionConstraint,
>(
  definition: TDefinition & {
    path: TPath;
    aliases: TAliases;
    params?: undefined;
  } & RouteParamCallbacks<
      InferSplitRouteParams<{ path: TPath; aliases: TAliases }>
    >
): DefinedSplitRoute<
  TDefinition & {
    path: TPath;
    aliases: TAliases;
    params?: undefined;
  } & RouteParamCallbacks<
      InferSplitRouteParams<{ path: TPath; aliases: TAliases }>
    >
>;
export function defineRoute<
  const TPath extends string,
  const TDefinition extends SplitRouteDefinitionConstraint,
>(
  definition: TDefinition & {
    path: TPath;
    aliases?: undefined;
    params?: undefined;
  } & RouteParamCallbacks<InferSplitRouteParams<{ path: TPath }>>
): DefinedSplitRoute<
  TDefinition & {
    path: TPath;
    aliases?: undefined;
    params?: undefined;
  } & RouteParamCallbacks<InferSplitRouteParams<{ path: TPath }>>
>;
export function defineRoute<
  const TPath extends string,
  const TParamsSchema extends StandardSchemaV1,
  const TDefinition extends SplitRouteDefinitionRemainder,
>(
  definition: TDefinition & {
    path: TPath;
    params: TParamsSchema;
  } & RouteParamsSchemaConstraint<
      NoInfer<TPath>,
      DefinitionAliases<NoInfer<TDefinition>>,
      NoInfer<TParamsSchema>
    > &
    RouteParamCallbacks<StandardSchemaV1.InferOutput<TParamsSchema>>
): DefinedSplitRoute<
  TDefinition & { path: TPath; params: TParamsSchema } & RouteParamCallbacks<
      StandardSchemaV1.InferOutput<TParamsSchema>
    >
>;
export function defineRoute(
  definition: SplitRouteDefinitionConstraint
): unknown {
  // The overloads add phantom ancestry; runtime declarations remain untouched.
  return definition;
}

/** Preserve the declaration tree and infer ancestry without constructing runtime state. */
export function defineRoutes<
  const TRoutes extends Omit<SplitRoutes, 'definitions'> & {
    definitions: readonly SplitRouteDefinitionConstraint[];
  },
>(
  routes: TRoutes &
    (NoInfer<TRoutes> extends SplitRoutes ? unknown : SplitRoutes) &
    RouteDefinitionsParamsSchemaConstraint<NoInfer<TRoutes>['definitions']>
): DefinedSplitRoutes<TRoutes> {
  return routes as DefinedSplitRoutes<TRoutes>;
}

export type RouteParamsCodec = {
  parse(params: SplitRouteRawParams): SplitRouteParams | undefined;
  serialize(params: SplitRouteParams): SplitRouteParams;
};

function createRouteParamsCodec(
  definition: SplitRouteDefinition
): RouteParamsCodec {
  const schema = definition.params;
  const serialize = definition.serializeParams?.bind(definition);
  return {
    parse: (params) => validateRouteParams(schema, params),
    // Without a custom serializer, the pattern encodes its primitive fields.
    serialize: (params) => serialize?.(params) ?? params,
  };
}

export type SplitRouteNode<TComponent = unknown> = {
  readonly definition: SplitRouteDefinition<TComponent>;
  readonly parent?: SplitRouteNode<TComponent>;
  readonly branch: readonly SplitRouteNode<TComponent>[];
  readonly pattern: RoutePattern;
  readonly params: RouteParamsCodec;
  readonly children: readonly SplitRouteNode<TComponent>[];
  readonly search: ReadonlySet<string>;
  readonly claims: readonly SplitRouteDefinition<TComponent>[];
  readonly externalSearch: readonly SplitRouteDefinition<TComponent>[];
};

/** Runtime route state owned by a router, or explicitly supplied by its host. */
export type SplitRoutesManifest<TComponent = unknown> = {
  readonly roots: readonly SplitRouteNode<TComponent>[];
  readonly byId: ReadonlyMap<string, SplitRouteNode<TComponent>>;
  readonly basePath: readonly string[];
  readonly globalSearch: ReadonlySet<string>;
  readonly unmatchedPathHandlers: readonly UnmatchedSplitPathHandler[];
  readonly defaultEntry?: SplitRoutes['defaultEntry'];
};

function routeSearchNamespaces(
  search: SplitRouteDefinition['search']
): Set<string> {
  if (search === '*') return new Set(['*']);
  const namespaces = new Set<string>();
  for (const namespace of search ?? []) {
    assertSafeSearchName(namespace, 'namespace');
    if (namespaces.has(namespace)) {
      throw new Error(`Duplicate split route search namespace "${namespace}"`);
    }
    namespaces.add(namespace);
  }
  return namespaces;
}

/** Compile static definitions into independent, caller-owned runtime state. */
export function createRoutesManifest<TComponent>(
  routes: SplitRoutes<TComponent>
): SplitRoutesManifest<TComponent> {
  const byId = new Map<string, SplitRouteNode<TComponent>>();
  const globalSearch = new Set(routes.globalSearch ?? []);
  for (const key of globalSearch) {
    if (!isSafeName(key)) {
      throw new Error(`Invalid global search key "${key}"`);
    }
  }

  const visit = (
    definitions: readonly SplitRouteDefinition<TComponent>[],
    parent?: SplitRouteNode<TComponent>
  ): SplitRouteNode<TComponent>[] => {
    const siblingPaths = new Set<string>();
    return definitions.map((definition) => {
      if (!isSafeName(definition.id)) {
        throw new Error(`Invalid split route id "${definition.id}"`);
      }
      if (byId.has(definition.id)) {
        throw new Error(`Duplicate split route id "${definition.id}"`);
      }

      for (const path of [definition.path, ...(definition.aliases ?? [])]) {
        if (!path) throw new Error(`Invalid split route path "${path}"`);
        const normalized = path.replace(/^\/+|\/+$/g, '');
        if (siblingPaths.has(normalized)) {
          throw new Error(`Duplicate sibling split route path "${normalized}"`);
        }
        siblingPaths.add(normalized);
      }

      const namespaces = routeSearchNamespaces(definition.search);
      const branch = [...(parent?.branch ?? [])];
      const children: SplitRouteNode<TComponent>[] = [];
      const node: SplitRouteNode<TComponent> = {
        definition,
        parent,
        branch,
        pattern: compileRoutePattern(definition),
        params: createRouteParamsCodec(definition),
        children,
        search: new Set([...(parent?.search ?? []), ...namespaces]),
        claims: [
          ...(parent?.claims ?? []),
          ...(definition.claim ? [definition] : []),
        ],
        externalSearch: [
          ...(parent?.externalSearch ?? []),
          ...(definition.externalSearch ? [definition] : []),
        ],
      };
      branch.push(node);
      byId.set(definition.id, node);
      children.push(...visit(definition.children ?? [], node));
      return node;
    });
  };

  return {
    roots: visit(routes.definitions),
    byId,
    basePath:
      typeof routes.basePath === 'string'
        ? routes.basePath.split('/').filter(Boolean)
        : [...(routes.basePath ?? [])],
    globalSearch,
    unmatchedPathHandlers: [...(routes.unmatchedPathHandlers ?? [])],
    defaultEntry: routes.defaultEntry,
  };
}

export function validateSplitRoutes<TComponent>(
  routes: SplitRoutes<TComponent>
): void {
  createRoutesManifest(routes);
}

/** Root pattern match only, including partial paths rejected by schema/children. */
export function findMatchingRouteId(
  routes: SplitRoutesManifest,
  segments: readonly string[]
): string | undefined {
  return routes.roots.find((node) => !node.pattern.match(segments).next().done)
    ?.definition.id;
}

export function validateRouteParams(
  schema: StandardSchemaV1 | undefined,
  params: SplitRouteParams
): SplitRouteParams | undefined {
  if (!schema) return params;
  const result = schema['~standard'].validate(params);
  if (result instanceof Promise) {
    throw new Error('Split route parameter schemas must be synchronous');
  }
  if (result.issues) return;
  if (
    !result.value ||
    typeof result.value !== 'object' ||
    Array.isArray(result.value)
  ) {
    throw new Error('Split route parameter schemas must return an object');
  }
  return result.value as SplitRouteParams;
}

export function rootRouteMatch(route: SplitRouteState | undefined) {
  return route?.matches[0];
}

export function routeParams<
  TParams extends SplitRouteParams = SplitRouteParams,
>(route: SplitRouteState | undefined): TParams {
  return Object.assign(
    {},
    ...(route?.matches.map((match) => match.params) ?? [])
  ) as TParams;
}

export function findRouteBranch<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  routeId: string
): readonly SplitRouteNode<TComponent>[] | undefined {
  return routes.byId.get(routeId)?.branch;
}

/** Validate host/persisted state without treating schema outputs as schema inputs. */
export function assertRouteState(
  routes: SplitRoutesManifest,
  route: unknown
): asserts route is SplitRouteState {
  if (
    !isRecord(route) ||
    !Array.isArray(route.matches) ||
    route.matches.length === 0
  ) {
    throw new Error('Split route state requires a nonempty match branch');
  }
  let parent: SplitRouteNode | undefined;
  for (const match of route.matches) {
    if (
      !isRecord(match) ||
      typeof match.id !== 'string' ||
      !isRecord(match.params)
    ) {
      throw new Error('Split route state contains an invalid match');
    }
    const node = routes.byId.get(match.id);
    if (!node || node.parent !== parent) {
      throw new Error('Split route state contains an invalid match branch');
    }
    parent = node;
  }
}

export function assertRouteEntry(
  routes: SplitRoutesManifest,
  entry: SplitRouterEntry
): void {
  assertRouteState(routes, entry?.location?.route);
}

function resolveRouteNode<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState
): SplitRouteNode<TComponent> {
  const leaf = takeLast(route.matches)!;
  const node = routes.byId.get(leaf.id);
  if (
    !node ||
    node.branch.length !== route.matches.length ||
    node.branch.some(
      (ancestor, index) => ancestor.definition.id !== route.matches[index]!.id
    )
  ) {
    throw new Error('Split route state contains an invalid match branch');
  }
  return node;
}

export function resolveRouteBranch<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState
): readonly SplitRouteNode<TComponent>[] {
  return resolveRouteNode(routes, route).branch;
}

export function getRouteClaim(
  routes: SplitRoutesManifest,
  route: SplitRouteState
): SplitRouteClaim | undefined {
  const claims = resolveRouteNode(routes, route).claims;
  const params = routeParams(route);
  for (let index = claims.length - 1; index >= 0; index -= 1) {
    const claim = claims[index]?.claim?.(params);
    if (!claim) continue;
    if (!isSafeName(claim.namespace) || claim.id.length === 0) {
      throw new Error('Split route returned an invalid claim');
    }
    return claim;
  }
}

function decodeRouteBranch<TComponent>(
  nodes: readonly SplitRouteNode<TComponent>[],
  segments: string[]
): SplitRouteState | undefined {
  for (const node of nodes) {
    for (const patternMatch of node.pattern.match(segments)) {
      const params = node.params.parse(patternMatch.params);
      if (!params) continue;
      const match: SplitRouteMatch = { id: node.definition.id, params };
      const childSegments = segments.slice(patternMatch.consumed);
      if (childSegments.length === 0) return { matches: [match] };
      const child = decodeRouteBranch(node.children, childSegments);
      if (child) return { matches: [match, ...child.matches] };
    }
  }
}

export function decodeRoute(
  routes: SplitRoutesManifest,
  segments: string[]
): SplitRouterEntry | undefined {
  const route = decodeRouteBranch(routes.roots, segments);
  return route ? { location: { route } } : undefined;
}

export function encodeRoute(
  routes: SplitRoutesManifest,
  entry: SplitRouterEntry
): string[] {
  const route = entry.location.route;
  const node = resolveRouteNode(routes, route);
  return node.branch.flatMap((ancestor, index) =>
    ancestor.pattern.format(
      ancestor.params.serialize(route.matches[index]!.params)
    )
  );
}

export function getRouteId(entry: SplitRouterEntry): string {
  return entry.location.route.matches[0].id;
}

export function getRouteSearchNamespaces<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState
): ReadonlySet<string> {
  return resolveRouteNode(routes, route).search;
}

export function assertSearchNamespacesAllowed(
  routes: SplitRoutesManifest,
  route: SplitRouteState,
  namespaces: readonly string[]
): void {
  const owned = getRouteSearchNamespaces(routes, route);
  for (const namespace of namespaces) {
    assertSafeSearchName(namespace, 'namespace');
    if (!owned.has('*') && !owned.has(namespace)) {
      throw new Error(
        `Split route does not own search namespace "${namespace}"`
      );
    }
  }
}

export function filterRouteSearch<TComponent>(
  routes: SplitRoutesManifest<TComponent>,
  route: SplitRouteState,
  search: SplitSearchState | undefined
): SplitSearchState | undefined {
  if (!search) return;
  const owned = getRouteSearchNamespaces(routes, route);
  if (owned.has('*')) return search;
  const filtered = Object.fromEntries(
    Object.entries(search).filter(([namespace]) => owned.has(namespace))
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function getExternalSearchKeys(
  routes: SplitRoutesManifest,
  entries: SplitRouterEntry[]
): Set<string> {
  const result = new Set(routes.globalSearch);
  for (const entry of entries) {
    for (const definition of resolveRouteNode(routes, entry.location.route)
      .externalSearch) {
      const externalSearch = definition.externalSearch;
      const keys =
        typeof externalSearch === 'function'
          ? externalSearch(entry)
          : (externalSearch ?? []);
      for (const key of keys) result.add(key);
    }
  }
  return result;
}
