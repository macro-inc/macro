import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { SplitRoutesManifest } from './routes';

export type BrowserHistoryIntent = 'push' | 'replace';
export type SplitRouteParams = Record<string, unknown>;
export type SplitRouteRawParams = Record<string, string | string[] | undefined>;
export type SerializedSearchParams = Record<string, string[]>;

export type SplitSearchUpdate =
  | SerializedSearchParams
  | undefined
  | ((
      current: SerializedSearchParams | undefined
    ) => SerializedSearchParams | undefined);

export type SplitSearchUpdateOptions = {
  history?: BrowserHistoryIntent;
};

export type SplitRouterNavigationCause =
  | 'initial'
  | 'external'
  | 'navigate'
  | 'history'
  | 'search'
  | 'layout';

export type SplitRouterMiddlewareRedirect = {
  type: 'redirect';
  to: string;
};

export type SplitRouterMiddlewareContext = {
  /** The currently accepted entry at this visible split position, if any. */
  from: Readonly<SplitRouterEntry> | undefined;
  /** The proposed entry. It has not been applied to the layout yet. */
  to: Readonly<SplitRouterEntry>;
  /** Canonical single-split pathname for `to`. */
  path: string;
  /** Raw incoming URL search on initial/external navigation, retained across redirects. */
  externalSearch?: string;
  cause: SplitRouterNavigationCause;
  signal: AbortSignal;
  redirect: (to: string) => SplitRouterMiddlewareRedirect;
};

export type SplitRouterMiddlewareResult =
  | SplitRouterMiddlewareRedirect
  | undefined
  | void;

export type SplitRouterMiddleware = (
  context: SplitRouterMiddlewareContext
) => SplitRouterMiddlewareResult | Promise<SplitRouterMiddlewareResult>;

export type SplitRouterMiddlewareConfig = {
  routes: SplitRoutesManifest;
  handlers: readonly SplitRouterMiddleware[];
};

export type SplitRouterMiddlewareRequest = {
  from?: SplitRouterEntry;
  to: SplitRouterEntry;
  externalSearch?: string;
  cause: SplitRouterNavigationCause;
  signal: AbortSignal;
};

export type SplitRouterMiddlewareRun =
  | SplitRouterEntry
  | Promise<SplitRouterEntry>;

type SplitRouteReference = {
  id: string;
  params?: StandardSchemaV1;
};

type SplitRouteTargetParams<TRoute extends SplitRouteReference> =
  {} extends InferSplitRouteNavigationParams<TRoute>
    ? { params?: InferSplitRouteNavigationParams<TRoute> }
    : { params: InferSplitRouteNavigationParams<TRoute> };

export type SplitRouteNavigationTarget<
  TRoute extends SplitRouteReference = SplitRouteReference,
> = TRoute extends unknown
  ? { route: TRoute } & SplitRouteTargetParams<NoInfer<TRoute>>
  : never;

export type SplitParentNavigationTarget = {
  parent: true;
  levels?: number;
};

export type SplitNonRouteNavigateTo =
  | number
  | string
  | SplitParentNavigationTarget;

export type SplitNavigateTo =
  | SplitNonRouteNavigateTo
  | {
      route: { id: string };
      params?: unknown;
    };

export type SplitNavigateOptions<TSplitId> = {
  replace?: boolean;
  target?: 'current' | 'new-split' | TSplitId;
  search?: Record<string, SplitSearchUpdate>;
  /** Bypasses final-destination claims and pending reservations, including history
   * traversal. The host layout may still enforce stricter duplicate policy. */
  allowDuplicate?: boolean;
};

export type SplitRouteClaim = {
  namespace: string;
  id: string;
};

export type SplitRouteMatch = {
  id: string;
  params: SplitRouteParams;
};

export type SplitRouteState = {
  matches: readonly [SplitRouteMatch, ...SplitRouteMatch[]];
};

export type SplitSearchState = Record<string, SerializedSearchParams>;

export type SplitLocation = {
  route: SplitRouteState;
  search?: SplitSearchState;
};

export type SplitRouterEntry = {
  location: SplitLocation;
};

type SplitRouteParamCallback<TParams, TResult> = {
  bivarianceHack(params: TParams): TResult;
}['bivarianceHack'];

export type SplitRouteDefinition<
  TComponent = unknown,
  TParamsSchema extends StandardSchemaV1 = StandardSchemaV1<
    unknown,
    SplitRouteParams
  >,
> = {
  id: string;
  path: string;
  aliases?: readonly string[];
  component?: TComponent;
  children?: readonly SplitRouteDefinition<TComponent>[];
  params?: TParamsSchema;
  serializeParams?: SplitRouteParamCallback<
    StandardSchemaV1.InferOutput<TParamsSchema>,
    SplitRouteRawParams
  >;
  claim?: SplitRouteParamCallback<
    StandardSchemaV1.InferOutput<TParamsSchema>,
    SplitRouteClaim | undefined
  >;
  search?: readonly string[] | '*';
  externalSearch?:
    | readonly string[]
    | ((entry: Readonly<SplitRouterEntry>) => readonly string[]);
  remountKey?: SplitRouteParamCallback<
    StandardSchemaV1.InferOutput<TParamsSchema>,
    string | number | undefined
  >;
};

type PathSegmentParams<TSegment extends string> =
  TSegment extends `:${infer TName}?`
    ? { [K in TName]?: string }
    : TSegment extends `:${infer TName}`
      ? { [K in TName]: string }
      : TSegment extends `*${infer TName}`
        ? { [K in TName]: string[] }
        : {};

type PathParams<TPath extends string> = TPath extends unknown
  ? string extends TPath
    ? SplitRouteParams
    : TPath extends `${infer TSegment}/${infer TRest}`
      ? PathSegmentParams<TSegment> & PathParams<TRest>
      : PathSegmentParams<TPath>
  : never;

/** Raw parameters produced by a route's canonical path and aliases. */
export type InferSplitRoutePathParams<
  TPath extends string,
  TAliases extends readonly string[] | undefined = undefined,
> = PathParams<
  TPath | (TAliases extends readonly string[] ? TAliases[number] : never)
>;

type Simplify<T> = { [K in keyof T]: T[K] };
type RequiredParamKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
type MergedParam<
  TParent,
  TLocal,
  K extends PropertyKey,
> = K extends keyof TLocal
  ? {} extends Pick<TLocal, K>
    ? K extends keyof TParent
      ? TParent[K] | TLocal[K]
      : TLocal[K]
    : TLocal[K]
  : K extends keyof TParent
    ? TParent[K]
    : never;

// Object.assign retains the parent value when an optional child field is absent.
type MergeRouteParams<TParent, TLocal> = TParent extends unknown
  ? TLocal extends unknown
    ? Simplify<
        {
          [K in
            | RequiredParamKeys<TParent>
            | RequiredParamKeys<TLocal>]: MergedParam<TParent, TLocal, K>;
        } & {
          [K in Exclude<
            keyof TParent | keyof TLocal,
            RequiredParamKeys<TParent> | RequiredParamKeys<TLocal>
          >]?: MergedParam<TParent, TLocal, K>;
        }
      >
    : never
  : never;

/** The schema output (or raw path params) owned by this node alone. */
export type InferSplitRouteParams<TRoute> = TRoute extends {
  params: infer TSchema extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<TSchema>
  : TRoute extends { path: infer TPath extends string }
    ? MergeRouteParams<
        {},
        InferSplitRoutePathParams<
          TPath,
          TRoute extends { aliases: infer TAliases }
            ? Extract<TAliases, readonly string[]>
            : undefined
        >
      >
    : SplitRouteParams;

type LocalNavigationParams<TRoute> = TRoute extends { params: StandardSchemaV1 }
  ? InferSplitRouteParams<TRoute>
  : TRoute extends { path: infer TPath extends string }
    ? MergeRouteParams<{}, PathParams<TPath>>
    : SplitRouteParams;

// Type-only ancestry. Declaration helpers never add properties to supplied objects.
declare const branchParams: unique symbol;

/** Params accumulated through this node, with child fields overriding ancestors. */
export type InferSplitRouteBranchParams<TRoute> = TRoute extends {
  readonly [branchParams]: { read: infer TParams };
}
  ? TParams
  : InferSplitRouteParams<TRoute>;

/** A flat destination bag must satisfy every ancestor's serializer. */
export type InferSplitRouteNavigationParams<TRoute> = TRoute extends {
  readonly [branchParams]: { navigate: infer TParams };
}
  ? TParams
  : LocalNavigationParams<TRoute>;

// Empty object schemas can infer an index signature of never. It must not
// prohibit the fields supplied by other nodes in the same branch.
type BranchParams<TParams> =
  TParams extends Record<string, never>
    ? {
        [K in keyof TParams as string extends K
          ? never
          : number extends K
            ? never
            : K]: TParams[K];
      }
    : TParams;

type DefinedRoute<TRoute, TParent, TParentNavigation> = TRoute extends unknown
  ? Omit<TRoute, 'children' | typeof branchParams> & {
      readonly [branchParams]: {
        read: MergeRouteParams<
          TParent,
          BranchParams<InferSplitRouteParams<TRoute>>
        >;
        navigate: MergeRouteParams<
          {},
          TParentNavigation & BranchParams<LocalNavigationParams<TRoute>>
        >;
      };
    } & (TRoute extends { children: infer TChildren extends readonly unknown[] }
        ? {
            readonly children: DefinedRouteList<
              TChildren,
              MergeRouteParams<
                TParent,
                BranchParams<InferSplitRouteParams<TRoute>>
              >,
              TParentNavigation & BranchParams<LocalNavigationParams<TRoute>>
            >;
          }
        : Pick<TRoute, Extract<keyof TRoute, 'children'>>)
  : never;

type DefinedRouteList<
  TDefinitions extends readonly unknown[],
  TParent,
  TParentNavigation,
> = {
  [K in keyof TDefinitions]: DefinedRoute<
    TDefinitions[K],
    TParent,
    TParentNavigation
  >;
};

/** One original definition with descendant ancestry inferred from this root. */
export type DefinedSplitRoute<TRoute> = DefinedRoute<TRoute, {}, {}>;

/** The original static tree, with ancestry available on references from that tree. */
export type DefinedSplitRoutes<
  TRoutes extends { definitions: readonly unknown[] },
> = Omit<TRoutes, 'definitions'> & {
  readonly definitions: DefinedRouteList<TRoutes['definitions'], {}, {}>;
};

type RouteUnion<TRoute> = TRoute extends { children: readonly (infer TChild)[] }
  ? TRoute | RouteUnion<TChild>
  : TRoute;

export type SplitRouteUnion<TRoutes extends SplitRoutes> = RouteUnion<
  TRoutes['definitions'][number]
>;

export type UnmatchedSplitPathContext = {
  segments: string[];
  matchedRouteId?: string;
};

export type UnmatchedSplitPathHandler = (
  context: UnmatchedSplitPathContext
) => SplitRouterEntry[] | undefined;

/** Static route declarations. Do not mutate them during a router's lifetime. */
export type SplitRoutes<TComponent = unknown> = {
  definitions: readonly SplitRouteDefinition<TComponent>[];
  unmatchedPathHandlers?: readonly UnmatchedSplitPathHandler[];
  defaultEntry?: () => SplitRouterEntry;
  globalSearch?: readonly string[];
  basePath?: string | readonly string[];
};

export type SplitRouterLayoutEntry<TSplitId> = SplitRouterEntry & {
  splitId: TSplitId;
};

export type SplitRouterLayoutSnapshot<TSplitId> = {
  entries: SplitRouterLayoutEntry<TSplitId>[];
};

export type SplitRouterSettledChange = {
  history: BrowserHistoryIntent;
};

export type SplitRouterHistorySnapshot = {
  entries: readonly SplitLocation[];
  index: number;
};

export interface SplitRouterLayout<TSplitId> {
  snapshot(): SplitRouterLayoutSnapshot<TSplitId>;
  updateCurrentEntry(
    splitId: TSplitId,
    update: (current: SplitRouterLayoutEntry<TSplitId>) => SplitRouterEntry
  ): void;
  open(
    request: SplitRouterEntry & {
      target?: TSplitId | 'new-split';
      replace?: boolean;
    }
  ): void;
  reconcile(entries: SplitRouterEntry[]): void;
  activate(splitId: TSplitId): void;
  subscribe(listener: (change: SplitRouterSettledChange) => void): () => void;
}

export type SplitRouterExternalLocationValue = {
  pathname: string;
  search: string;
  hash: string;
};

export interface SplitRouterExternalLocation {
  read(): SplitRouterExternalLocationValue;
  subscribe(
    listener: (location: SplitRouterExternalLocationValue) => void
  ): () => void;
  commit(
    location: SplitRouterExternalLocationValue,
    options: { history: BrowserHistoryIntent }
  ): void;
}

export type SplitRouterOptions<TSplitId> = {
  layout: SplitRouterLayout<TSplitId>;
  routes: SplitRoutes | SplitRoutesManifest;
  location: SplitRouterExternalLocation;
  middleware?: readonly SplitRouterMiddleware[];
};

export type SplitNavigate<TSplitId> = {
  <const TTarget extends { route: SplitRouteReference }>(
    to: TTarget & SplitRouteNavigationTarget<NoInfer<TTarget['route']>>,
    options?: SplitNavigateOptions<TSplitId>
  ): void;
  (to: SplitNonRouteNavigateTo, options?: SplitNavigateOptions<TSplitId>): void;
};

export interface SplitRouter<TSplitId> {
  readonly routes: SplitRoutesManifest;
  route(splitId: TSplitId): SplitRouteState | undefined;
  location(splitId: TSplitId): SplitLocation | undefined;
  search(
    splitId: TSplitId,
    namespace: string
  ): SerializedSearchParams | undefined;
  navigate<const TTarget extends { route: SplitRouteReference }>(
    splitId: TSplitId,
    to: TTarget & SplitRouteNavigationTarget<NoInfer<TTarget['route']>>,
    options?: SplitNavigateOptions<TSplitId>
  ): void;
  navigate(
    splitId: TSplitId,
    to: SplitNonRouteNavigateTo,
    options?: SplitNavigateOptions<TSplitId>
  ): void;
  canGo(splitId: TSplitId, delta: number): boolean;
  history(splitId: TSplitId): SplitRouterHistorySnapshot | undefined;
  updateSearch(
    splitId: TSplitId,
    namespace: string,
    update: SplitSearchUpdate,
    options?: SplitSearchUpdateOptions
  ): void;
  href(splitId: TSplitId): string;
  isReady(): boolean;
  settled(): Promise<void>;
  subscribe(listener: (splitId: TSplitId | undefined) => void): () => void;
  dispose(): void;
}
