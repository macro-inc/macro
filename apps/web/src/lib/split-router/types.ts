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
  {} extends InferSplitRouteParams<TRoute>
    ? { params?: InferSplitRouteParams<TRoute> }
    : { params: InferSplitRouteParams<TRoute> };

export type SplitRouteNavigationTarget<
  TRoute extends SplitRouteReference = SplitRouteReference,
> = { route: TRoute } & SplitRouteTargetParams<TRoute>;

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
  remountKey?: (params: SplitRouteParams) => string | number | undefined;
};

export type InferSplitRouteParams<TRoute> = TRoute extends {
  params: infer TSchema extends StandardSchemaV1;
}
  ? StandardSchemaV1.InferOutput<TSchema>
  : SplitRouteParams;

export type UnmatchedSplitPathContext = {
  segments: string[];
  matchedRouteId?: string;
};

export type UnmatchedSplitPathHandler = (
  context: UnmatchedSplitPathContext
) => SplitRouterEntry[] | undefined;

/** Static route declarations. Do not mutate them during a router's lifetime. */
export type SplitRoutes<TComponent = unknown> = {
  definitions: SplitRouteDefinition<TComponent>[];
  unmatchedPathHandlers?: UnmatchedSplitPathHandler[];
  defaultEntry?: () => SplitRouterEntry;
  globalSearch?: string[];
  basePath?: string | string[];
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
  <const TRoute extends SplitRouteReference>(
    to: SplitRouteNavigationTarget<TRoute>,
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
  navigate<const TRoute extends SplitRouteReference>(
    splitId: TSplitId,
    to: SplitRouteNavigationTarget<TRoute>,
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
