import type { MaybeAccessor } from '@app/lib/signals/access';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import type {
  AnyVariables,
  Client,
  CombinedError,
  DocumentInput,
  GraphQLRequestParams,
  Operation,
  OperationContext,
  OperationResult,
  OperationResultSource,
  RequestPolicy,
} from '@urql/core';

/** Options shared by enabled and disabled urql queries. */
type UrqlQueryCommonOptions<QueryData, Variables extends AnyVariables, Data> = {
  /** Overrides the client supplied by the nearest {@link UrqlProvider}. */
  client?: Client;
  /** Enables automatic execution. Defaults to true. */
  enabled?: boolean;
  /** Default request policy for this query. */
  requestPolicy?: RequestPolicy;
  /** Additional operation context merged into each execution. */
  context?: Partial<OperationContext>;
  /** Retains prior data while a new request starts. Defaults to true. */
  keepPreviousData?: boolean;
  /** Transforms raw GraphQL data before exposing it through the result. */
  select?: (data: QueryData) => Data;
  /** Observes every raw result after the query state has been updated. */
  onResult?: (result: OperationResult<QueryData, Variables>) => void;
};

/**
 * Reactive urql query options.
 *
 * Enabled requests retain urql's conditional variable requirements. A disabled
 * branch may omit variables so callers can represent unavailable inputs
 * without manufacturing placeholder values.
 */
export type UrqlQueryOptions<
  QueryData = unknown,
  Variables extends AnyVariables = AnyVariables,
  Data = QueryData,
> =
  | (GraphQLRequestParams<QueryData, Variables> &
      UrqlQueryCommonOptions<QueryData, Variables, Data>)
  | ({
      query: DocumentInput<QueryData, Variables>;
      variables?: Variables;
      enabled: false;
    } & UrqlQueryCommonOptions<QueryData, Variables, Data>);

/** Overrides applied to a single imperative query reexecution. */
export type UrqlQueryRefetchOptions = {
  /** Overrides the base request policy, for example with `network-only`. */
  requestPolicy?: RequestPolicy;
  /** Merges over the query's base operation context. */
  context?: Partial<OperationContext>;
  /** Rejects the returned promise when the result contains a CombinedError. */
  throwOnError?: boolean;
};

/** TanStack-style high-level status for an urql query. */
export type UrqlQueryStatus = 'pending' | 'success' | 'error';

/** Whether the binding is currently awaiting another result. */
export type UrqlQueryFetchStatus = 'idle' | 'fetching';

/**
 * Stable reactive result returned by {@link createUrqlQuery}.
 *
 * Properties are read through a stable proxy over a Solid store and must be
 * accessed reactively rather than destructured. urql-native result fields
 * remain available alongside the TanStack-style status flags.
 */
export type UrqlQueryResult<
  Data = unknown,
  Variables extends AnyVariables = AnyVariables,
  QueryData = Data,
> = {
  readonly data: Data | undefined;
  readonly error: CombinedError | null;
  /** urql execution activity before adapting stale results for TanStack. */
  readonly fetching: boolean;
  readonly status: UrqlQueryStatus;
  readonly fetchStatus: UrqlQueryFetchStatus;
  readonly isPending: boolean;
  readonly isLoading: boolean;
  readonly isInitialLoading: boolean;
  readonly isFetching: boolean;
  readonly isRefetching: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly isEnabled: boolean;
  readonly isFetched: boolean;
  readonly stale: boolean;
  readonly hasNext: boolean;
  readonly operation: Operation<QueryData, Variables> | undefined;
  readonly extensions: Record<string, unknown> | undefined;
  /**
   * Reexecutes the current request and resolves with this same stable result.
   * Superseded or disposed reexecutions resolve instead of leaving a pending
   * promise. A disabled query without variables is a no-op.
   */
  refetch(
    options?: UrqlQueryRefetchOptions
  ): Promise<UrqlQueryResult<Data, Variables, QueryData>>;
};

/** Ordered page data and the parameters used to load each page. */
export type UrqlInfiniteData<PageData, PageParam> = {
  readonly pages: PageData[];
  readonly pageParams: PageParam[];
};

/** Metadata supplied to an infinite query's result observer. */
export type UrqlInfiniteQueryPageContext<PageParam> = {
  readonly pageIndex: number;
  readonly pageParam: PageParam;
};

/** Reactive options for a paginated, live urql query. */
export type UrqlInfiniteQueryOptions<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData = UrqlInfiniteData<PageData, PageParam>,
> = {
  /** Generated GraphQL document used for every page. */
  query: DocumentInput<PageData, Variables>;
  /** Parameter used for the first page. */
  initialPageParam: PageParam;
  /** Builds generated query variables for one page parameter. */
  variables: (pageParam: PageParam, pageIndex: number) => Variables;
  /** Returns the parameter for the page after the current final page. */
  getNextPageParam: (
    lastPage: PageData,
    pages: readonly PageData[],
    lastPageParam: PageParam,
    pageParams: readonly PageParam[]
  ) => PageParam | null | undefined;
  /** Maps the accumulated pages to consumer-facing data. */
  select?: (data: UrqlInfiniteData<PageData, PageParam>) => SelectedData;
  /** Overrides the client supplied by the nearest {@link UrqlProvider}. */
  client?: Client;
  /** Enables page subscriptions. Defaults to true. */
  enabled?: boolean;
  /** Default request policy for every page. */
  requestPolicy?: RequestPolicy;
  /** Additional operation context merged into every page execution. */
  context?: Partial<OperationContext>;
  /** Retains accumulated data while the query identity changes. */
  keepPreviousData?: boolean;
  /** Observes page results after the corresponding page state updates. */
  onResult?: (
    result: OperationResult<PageData, Variables>,
    page: UrqlInfiniteQueryPageContext<PageParam>
  ) => void;
};

/** Stable reactive result returned by {@link createUrqlInfiniteQuery}. */
export type UrqlInfiniteQueryResult<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData = UrqlInfiniteData<PageData, PageParam>,
> = {
  readonly data: SelectedData | undefined;
  readonly error: CombinedError | null;
  readonly fetching: boolean;
  readonly stale: boolean;
  readonly status: UrqlQueryStatus;
  readonly fetchStatus: UrqlQueryFetchStatus;
  readonly isPending: boolean;
  readonly isLoading: boolean;
  readonly isInitialLoading: boolean;
  readonly isFetching: boolean;
  readonly isRefetching: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly isEnabled: boolean;
  readonly isFetched: boolean;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isFetchNextPageError: boolean;
  /** Discards every continuation page while retaining the live initial page. */
  resetToInitialPage(): void;
  fetchNextPage(
    options?: UrqlQueryRefetchOptions
  ): Promise<
    UrqlInfiniteQueryResult<PageData, Variables, PageParam, SelectedData>
  >;
  refetch(
    options?: UrqlQueryRefetchOptions
  ): Promise<
    UrqlInfiniteQueryResult<PageData, Variables, PageParam, SelectedData>
  >;
};

/** Inputs supplied to a custom mutation execution strategy. */
export type UrqlMutationExecutorArgs<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
> = {
  /** Client resolved from the mutation override or nearest provider. */
  client: Client;
  /** Generated GraphQL mutation document configured for this mutation. */
  mutation: TypedDocumentNode<MutationData, Variables>;
  /** Consumer input supplied to the current mutation execution. */
  input: Input;
  /** Fully merged base and execution-specific operation context. */
  context: Partial<OperationContext>;
};

/** Overrides how a mutation operation is submitted to urql. */
export type UrqlMutationExecutor<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
> = (
  args: UrqlMutationExecutorArgs<MutationData, Variables, Input>
) =>
  | OperationResultSource<OperationResult<MutationData, Variables>>
  | Promise<OperationResult<MutationData, Variables>>;

type MutationCallbackResult = void | Promise<void>;

type MutationCallbacks<
  MutationData,
  Variables extends AnyVariables,
  Input,
  OnMutateResult,
> = {
  /** Runs after a result without a GraphQL or network error is received. */
  onSuccess?: (
    data: MutationData | undefined,
    input: Input,
    onMutateResult: OnMutateResult | undefined,
    result: OperationResult<MutationData, Variables>
  ) => MutationCallbackResult;
  /** Runs after a result error or mutation execution failure. */
  onError?: (
    error: CombinedError,
    input: Input,
    onMutateResult: OnMutateResult | undefined,
    result: OperationResult<MutationData, Variables> | undefined
  ) => MutationCallbackResult;
  /** Runs after the immediate mutation submission settles. */
  onSettled?: (
    data: MutationData | undefined,
    error: CombinedError | null,
    input: Input,
    onMutateResult: OnMutateResult | undefined,
    result: OperationResult<MutationData, Variables> | undefined
  ) => MutationCallbackResult;
};

/** Overrides applied to one mutation execution. */
export type UrqlMutationExecutionOptions<
  MutationData,
  Variables extends AnyVariables,
  Input = Variables,
  OnMutateResult = void,
> = MutationCallbacks<MutationData, Variables, Input, OnMutateResult> & {
  /** Operation context merged over the mutation's base context. */
  context?: Partial<OperationContext>;
};

type UrqlMutationExecutionOption<
  MutationData,
  Variables extends AnyVariables,
  Input,
> = [Input] extends [Variables]
  ? { execute?: UrqlMutationExecutor<MutationData, Variables, Input> }
  : { execute: UrqlMutationExecutor<MutationData, Variables, Input> };

/** Reactive options for an imperative urql mutation. */
export type UrqlMutationOptions<
  MutationData = unknown,
  Variables extends AnyVariables = AnyVariables,
  Input = Variables,
  OnMutateResult = void,
> = MutationCallbacks<MutationData, Variables, Input, OnMutateResult> & {
  /** Generated GraphQL mutation document. */
  mutation: TypedDocumentNode<MutationData, Variables>;
  /** Overrides the client supplied by the nearest {@link UrqlProvider}. */
  client?: Client;
  /** Base operation context merged into every execution. */
  context?: Partial<OperationContext>;
  /** Runs before submission and may return context for lifecycle callbacks. */
  onMutate?: (input: Input) => OnMutateResult | Promise<OnMutateResult>;
} & UrqlMutationExecutionOption<MutationData, Variables, Input>;

/** Stable reactive state for an imperative urql mutation. */
export type UrqlMutationResult<
  MutationData = unknown,
  Variables extends AnyVariables = AnyVariables,
  Input = Variables,
  OnMutateResult = void,
> = {
  readonly data: MutationData | undefined;
  readonly error: CombinedError | null;
  readonly isPending: boolean;
  readonly stale: boolean;
  readonly operation: Operation<MutationData, Variables> | undefined;
  /** Submits one mutation without waiting for its raw urql result. */
  mutate(
    input: Input,
    options?: UrqlMutationExecutionOptions<
      MutationData,
      Variables,
      Input,
      OnMutateResult
    >
  ): void;
  /**
   * Submits one mutation and resolves with its raw urql result. GraphQL and
   * network errors remain represented on the result; execution failures throw.
   */
  mutateAsync(
    input: Input,
    options?: UrqlMutationExecutionOptions<
      MutationData,
      Variables,
      Input,
      OnMutateResult
    >
  ): Promise<OperationResult<MutationData, Variables>>;
};

/** One reactive source of urql clients accepted by {@link UrqlProvider}. */
export type UrqlClientSource = MaybeAccessor<Client>;
