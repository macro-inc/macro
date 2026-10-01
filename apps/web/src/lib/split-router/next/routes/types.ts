import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { PaneArrival, PaneId } from '../panes/types';

export type { PaneArrival, PaneId };

export type SplitRouteParams = Record<string, unknown>;
export type SplitRouteRawParams = Record<string, string | string[] | undefined>;
export type SerializedSearchParams = Record<string, string[]>;
export type SplitSearchState = Record<string, SerializedSearchParams>;

export type SplitSearchUpdate =
  | SerializedSearchParams
  | undefined
  | ((
      current: SerializedSearchParams | undefined
    ) => SerializedSearchParams | undefined);

export type SplitRouteMatch = {
  id: string;
  params: SplitRouteParams;
};

export type SplitRouteState = {
  matches: readonly [SplitRouteMatch, ...SplitRouteMatch[]];
};

export type SplitLocation = {
  route: SplitRouteState;
  search?: SplitSearchState;
};

export type Entry = {
  id: string;
  location: SplitLocation;
  /** Output of the route's state schema; round-trips through browser history state. */
  state?: unknown;
  /** In-memory props for the view this entry opens; never serialized. */
  props?: unknown;
  /** Deliver `props` again when returning to this entry, instead of dropping them. */
  keepProps?: boolean;
  /** App metadata such as how the entry was reached; memory only. */
  meta?: Readonly<Record<string, unknown>>;
};

export type PreloadIntent = 'initial' | 'navigate' | 'external' | 'hover';

export type WriteMode = 'push' | 'replace';

export type SplitRouteClaim = {
  namespace: string;
  id: string;
};

/** Route metadata. Hosts extend this interface through declaration merging. */
export interface SplitRouteInfo {
  readonly [key: string]: unknown;
}

/** The split router's slice of browser history state. */
export type SplitHistoryState = {
  panes: readonly SplitHistoryPane[];
};

export type SplitHistoryPane = {
  pane: PaneId;
  entry: string;
  state?: unknown;
};

/** Everything below the split router's mount point. */
export type ExternalLocation = {
  path: string;
  search: string;
  hash: string;
  state?: SplitHistoryState;
};

type SplitRouteParamCallback<TParams, TResult> = {
  bivarianceHack(params: TParams): TResult;
}['bivarianceHack'];

export type SplitRouteRemountContext = {
  entryId: string;
};

export type SplitRoutePreloadContext<TParams = SplitRouteParams> = {
  params: TParams;
  search: SplitSearchState | undefined;
  intent: PreloadIntent;
  signal: AbortSignal;
};

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
  state?: StandardSchemaV1;
  serializeParams?: SplitRouteParamCallback<
    StandardSchemaV1.InferOutput<TParamsSchema>,
    SplitRouteRawParams
  >;
  claim?: SplitRouteParamCallback<
    StandardSchemaV1.InferOutput<TParamsSchema>,
    SplitRouteClaim | undefined
  >;
  /**
   * Pane search namespaces this route adds. Leaving it undefined adds no
   * restriction; a root route without `search` owns every namespace.
   */
  search?: readonly string[];
  /** Unprefixed query keys kept in the URL while this route is shown. */
  externalSearch?:
    | readonly string[]
    | ((entry: Readonly<Entry>) => readonly string[]);
  remountKey?: {
    bivarianceHack(
      params: StandardSchemaV1.InferOutput<TParamsSchema>,
      context: SplitRouteRemountContext
    ): string | number | undefined;
  }['bivarianceHack'];
  preload?: SplitRouteParamCallback<
    SplitRoutePreloadContext<StandardSchemaV1.InferOutput<TParamsSchema>>,
    void | Promise<unknown>
  >;
  info?: SplitRouteInfo;
};

/** Static route declarations. Do not mutate them during a router's lifetime. */
export type SplitRoutes<TComponent = unknown> = {
  definitions: readonly SplitRouteDefinition<TComponent>[];
  defaultRoute: () => SplitRouteState;
  globalSearch?: readonly string[];
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

type LocalRouteStateSchema<TRoute> = TRoute extends {
  state: infer TSchema extends StandardSchemaV1;
}
  ? TSchema
  : undefined;

type EffectiveRouteStateSchema<TRoute, TParentSchema> =
  LocalRouteStateSchema<TRoute> extends StandardSchemaV1
    ? LocalRouteStateSchema<TRoute>
    : TParentSchema;

type InferSplitRouteStateSchema<TRoute> = TRoute extends {
  readonly [branchParams]: { state: infer TSchema };
}
  ? TSchema
  : LocalRouteStateSchema<TRoute>;

export type InferSplitRouteState<TRoute> =
  InferSplitRouteStateSchema<TRoute> extends infer TSchema extends
    StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TSchema>
    : never;

export type InferSplitRouteStateInput<TRoute> =
  InferSplitRouteStateSchema<TRoute> extends infer TSchema extends
    StandardSchemaV1
    ? StandardSchemaV1.InferInput<TSchema>
    : never;

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

type DefinedRoute<TRoute, TParent, TParentNavigation, TParentStateSchema> =
  TRoute extends unknown
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
          state: EffectiveRouteStateSchema<TRoute, TParentStateSchema>;
        };
      } & (TRoute extends {
          children: infer TChildren extends readonly unknown[];
        }
          ? {
              readonly children: DefinedRouteList<
                TChildren,
                MergeRouteParams<
                  TParent,
                  BranchParams<InferSplitRouteParams<TRoute>>
                >,
                TParentNavigation & BranchParams<LocalNavigationParams<TRoute>>,
                EffectiveRouteStateSchema<TRoute, TParentStateSchema>
              >;
            }
          : Pick<TRoute, Extract<keyof TRoute, 'children'>>)
    : never;

type DefinedRouteList<
  TDefinitions extends readonly unknown[],
  TParent,
  TParentNavigation,
  TParentStateSchema,
> = {
  [K in keyof TDefinitions]: DefinedRoute<
    TDefinitions[K],
    TParent,
    TParentNavigation,
    TParentStateSchema
  >;
};

/** One original definition with descendant ancestry inferred from this root. */
export type DefinedSplitRoute<TRoute> = DefinedRoute<TRoute, {}, {}, undefined>;

/** The original static tree, with ancestry available on references from that tree. */
export type DefinedSplitRoutes<
  TRoutes extends { definitions: readonly unknown[] },
> = Omit<TRoutes, 'definitions'> & {
  readonly definitions: DefinedRouteList<
    TRoutes['definitions'],
    {},
    {},
    undefined
  >;
};

type RouteUnion<TRoute> = TRoute extends { children: readonly (infer TChild)[] }
  ? TRoute | RouteUnion<TChild>
  : TRoute;

export type SplitRouteUnion<TRoutes extends SplitRoutes> = RouteUnion<
  TRoutes['definitions'][number]
>;

export type SplitRouteReference = {
  id: string;
  params?: StandardSchemaV1;
  state?: StandardSchemaV1;
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

export type SplitNavigationTarget =
  | string
  | { route: { id: string }; params?: unknown };

export type SplitRouterStateUpdate<TInput = unknown, TOutput = TInput> =
  | TInput
  | ((current: TOutput | undefined) => TInput);
