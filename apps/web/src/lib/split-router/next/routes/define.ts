import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
  DefinedSplitRoute,
  DefinedSplitRoutes,
  Entry,
  InferSplitRouteParams,
  InferSplitRoutePathParams,
  SplitRouteClaim,
  SplitRouteInfo,
  SplitRoutePreloadContext,
  SplitRouteRawParams,
  SplitRouteRemountContext,
  SplitRoutes,
} from './types';

type SplitRouteDefinitionConstraint = {
  id: string;
  path: string;
  aliases?: readonly string[];
  component?: unknown;
  children?: readonly SplitRouteDefinitionConstraint[];
  params?: StandardSchemaV1;
  state?: StandardSchemaV1;
  serializeParams?: unknown;
  claim?: unknown;
  search?: readonly string[];
  externalSearch?:
    | readonly string[]
    | ((entry: Readonly<Entry>) => readonly string[]);
  remountKey?: unknown;
  preload?: unknown;
  info?: SplitRouteInfo;
};

type RouteParamCallbacks<TParams> = {
  serializeParams?: (params: TParams) => SplitRouteRawParams;
  claim?: (params: TParams) => SplitRouteClaim | undefined;
  remountKey?: (
    params: TParams,
    context: SplitRouteRemountContext
  ) => string | number | undefined;
  preload?: (
    context: SplitRoutePreloadContext<TParams>
  ) => void | Promise<unknown>;
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
