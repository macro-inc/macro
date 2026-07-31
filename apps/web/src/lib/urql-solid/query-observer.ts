import {
  type AnyVariables,
  type Client,
  type CombinedError,
  createRequest,
  type OperationContext,
  type OperationResult,
  type OperationResultSource,
} from '@urql/core';
import { onEnd, pipe, type Subscription, subscribe } from 'wonka';
import type { ObserverEndReason, UrqlObserver } from './observer';
import type {
  UrqlQueryOptions,
  UrqlQueryRefetchOptions,
  UrqlQueryResult,
} from './types';
import { getQueryStatus, ObserverResult, toCombinedError } from './utils';

type PendingRefetch<QueryData, Variables extends AnyVariables, Data> = {
  resolve: (result: UrqlQueryResult<Data, Variables, QueryData>) => void;
  reject: (error: unknown) => void;
  throwOnError: boolean;
};

type QueryExecution<QueryData, Variables extends AnyVariables, Data> = {
  options: UrqlQueryOptions<QueryData, Variables, Data>;
  source: OperationResultSource<OperationResult<QueryData, Variables>>;
  subscription?: Subscription;
  pending?: PendingRefetch<QueryData, Variables, Data>;
  lastError?: CombinedError;
};

type QueryObserverState<QueryData, Variables extends AnyVariables, Data> = {
  data: Data | undefined;
  error: CombinedError | null;
  fetching: boolean;
  stale: boolean;
  hasNext: boolean;
  operation: OperationResult<QueryData, Variables>['operation'] | undefined;
  extensions: Record<string, unknown> | undefined;
  enabled: boolean;
  fetched: boolean;
};

/** Observer for one live urql query source. */
export class QueryObserver<
  QueryData,
  Variables extends AnyVariables,
  Data = QueryData,
> implements
    UrqlObserver<
      UrqlQueryOptions<QueryData, Variables, Data>,
      UrqlQueryResult<Data, Variables, QueryData>
    >
{
  private client: Client;
  private options: UrqlQueryOptions<QueryData, Variables, Data>;
  private execution: QueryExecution<QueryData, Variables, Data> | undefined;
  // Distinguishes a new query/variables pair from a same-request refetch when
  // keepPreviousData is disabled. Client changes create a new observer.
  private lastRequestKey: number | undefined;
  private state: QueryObserverState<QueryData, Variables, Data> = {
    data: undefined,
    error: null,
    fetching: false,
    stale: false,
    hasNext: false,
    operation: undefined,
    extensions: undefined,
    enabled: true,
    fetched: false,
  };
  private readonly result = new ObserverResult(() => this.getCurrentResult());
  private destroyed = false;

  constructor(
    client: Client,
    options: UrqlQueryOptions<QueryData, Variables, Data>,
    executeImmediately = true
  ) {
    this.client = client;
    this.options = options;

    if (executeImmediately) {
      this.setOptions(options, client);
    } else {
      this.setState({ enabled: options.enabled !== false });
    }
  }

  getCurrentResult(): UrqlQueryResult<Data, Variables, QueryData> {
    const status = getQueryStatus(this.state.error, this.state.fetched);

    const isFetching =
      this.state.fetching || this.state.stale || this.state.hasNext;

    return {
      data: this.state.data,
      error: this.state.error,
      fetching: this.state.fetching,
      status,
      fetchStatus: isFetching ? 'fetching' : 'idle',
      isPending: status === 'pending',
      isLoading: status === 'pending' && isFetching,
      isInitialLoading: status === 'pending' && isFetching,
      isFetching,
      isRefetching: status !== 'pending' && isFetching,
      isSuccess: status === 'success',
      isError: status === 'error',
      isEnabled: this.state.enabled,
      isFetched: this.state.fetched,
      stale: this.state.stale,
      hasNext: this.state.hasNext,
      operation: this.state.operation,
      extensions: this.state.extensions,
      refetch: this.refetch,
    };
  }

  setReference(result: UrqlQueryResult<Data, Variables, QueryData>): void {
    this.result.setReference(result);
  }

  setOptions(
    options: UrqlQueryOptions<QueryData, Variables, Data>,
    client: Client
  ): void {
    if (this.destroyed) return;

    this.options = options;
    this.client = client;

    if (options.enabled === false) {
      if (this.execution) {
        this.onEnd(this.execution, 'cancelled');
      }

      this.setState({
        enabled: false,
        fetching: false,
        stale: false,
        hasNext: false,
      });
      this.result.notify();

      return;
    }

    this.execute(options, client);
  }

  subscribe(
    listener: (result: UrqlQueryResult<Data, Variables, QueryData>) => void
  ): () => void {
    return this.result.subscribe(listener);
  }

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    if (this.execution) {
      this.onEnd(this.execution, 'cancelled');
    }

    this.result.clear();
  }

  readonly refetch = (
    refetchOptions: UrqlQueryRefetchOptions = {}
  ): Promise<UrqlQueryResult<Data, Variables, QueryData>> => {
    if (this.destroyed) {
      return Promise.resolve(this.result.getActionResult());
    }

    if (
      this.options.enabled === false &&
      this.options.variables === undefined
    ) {
      return Promise.resolve(this.result.getActionResult());
    }

    return new Promise((resolve, reject) => {
      this.execute(this.options, this.client, refetchOptions, {
        resolve,
        reject,
        throwOnError: refetchOptions.throwOnError === true,
      });
    });
  };

  private execute(
    options: UrqlQueryOptions<QueryData, Variables, Data>,
    client: Client,
    refetchOptions?: UrqlQueryRefetchOptions,
    pending?: PendingRefetch<QueryData, Variables, Data>
  ): void {
    if (this.execution) {
      this.onEnd(this.execution, 'cancelled');
    }

    let execution: QueryExecution<QueryData, Variables, Data> | undefined;

    try {
      const variables = options.variables as Variables;
      const request = createRequest<QueryData, Variables>(
        options.query,
        variables
      );

      const context: Partial<OperationContext> = {
        requestPolicy: options.requestPolicy,
        ...options.context,
        ...refetchOptions?.context,
        ...(refetchOptions?.requestPolicy
          ? { requestPolicy: refetchOptions.requestPolicy }
          : {}),
      };

      const requestChanged =
        this.lastRequestKey !== undefined &&
        this.lastRequestKey !== request.key;

      this.lastRequestKey = request.key;

      if (options.keepPreviousData === false && requestChanged) {
        this.setState({
          data: undefined,
          error: null,
          operation: undefined,
          extensions: undefined,
          fetched: false,
        });
      }

      const currentExecution: QueryExecution<QueryData, Variables, Data> = {
        options,
        source: client.executeQuery<QueryData, Variables>(request, context),
        pending,
      };

      execution = currentExecution;
      this.execution = currentExecution;

      this.setState({
        enabled: options.enabled !== false,
        fetching: true,
        stale: false,
        hasNext: false,
      });
      this.result.notify();

      const subscription = pipe(
        currentExecution.source,
        onEnd(() => this.onEnd(currentExecution, 'completed')),
        subscribe((nextResult) =>
          this.handleResult(currentExecution, nextResult)
        )
      );

      if (this.execution === currentExecution) {
        currentExecution.subscription = subscription;
      } else {
        subscription.unsubscribe();
      }
    } catch (cause) {
      if (execution && this.execution === execution) {
        this.execution = undefined;
        execution.subscription?.unsubscribe();
      }

      const error = toCombinedError(cause);

      this.setState({
        error,
        enabled: options.enabled !== false,
        fetching: false,
        stale: false,
        hasNext: false,
        fetched: true,
      });

      if (pending?.throwOnError) pending.reject(error);
      else pending?.resolve(this.result.getActionResult());

      this.result.notify();
    }
  }

  private onEnd(
    execution: QueryExecution<QueryData, Variables, Data>,
    reason: ObserverEndReason
  ): void {
    if (this.execution !== execution) return;

    this.execution = undefined;

    if (reason === 'cancelled') {
      this.settle(execution, reason);
      execution.subscription?.unsubscribe();

      return;
    }

    this.setState({
      fetching: false,
      stale: false,
      hasNext: false,
    });

    this.settle(execution, reason);
    this.result.notify();
  }

  private handleResult(
    execution: QueryExecution<QueryData, Variables, Data>,
    nextResult: OperationResult<QueryData, Variables>
  ): void {
    if (this.execution !== execution) return;

    const stale = nextResult.stale === true;
    const hasNext = nextResult.hasNext === true;
    let data: Data | undefined;
    let error = nextResult.error ?? null;

    if (nextResult.data != null) {
      try {
        const select = execution.options.select;
        data = select
          ? select(nextResult.data as QueryData)
          : (nextResult.data as Data);
      } catch (cause) {
        error = toCombinedError(cause);
      }
    }

    execution.lastError = error ?? undefined;

    this.setState({
      ...(data !== undefined ? { data } : {}),
      error,
      fetching: false,
      stale,
      hasNext,
      operation: nextResult.operation,
      extensions: nextResult.extensions,
      fetched: true,
    });
    this.result.notify();

    if (!stale && !hasNext) {
      this.settle(execution, 'completed');
    }

    try {
      execution.options.onResult?.(nextResult);
    } catch (cause) {
      console.error('urql query result observer failed', cause);
    }
  }

  private settle(
    execution: QueryExecution<QueryData, Variables, Data>,
    reason: ObserverEndReason
  ): void {
    const pending = execution.pending;

    execution.pending = undefined;

    if (
      reason === 'completed' &&
      pending?.throwOnError &&
      execution.lastError
    ) {
      pending.reject(execution.lastError);
    } else {
      pending?.resolve(this.result.getActionResult());
    }
  }

  private setState(
    nextState: Partial<QueryObserverState<QueryData, Variables, Data>>
  ): void {
    this.state = { ...this.state, ...nextState };
  }
}

/** Creates an observer for {@link createUrqlQuery}. */
export function createQueryObserver<
  QueryData,
  Variables extends AnyVariables,
  Data = QueryData,
>(
  client: Client,
  options: UrqlQueryOptions<QueryData, Variables, Data>
): QueryObserver<QueryData, Variables, Data> {
  return new QueryObserver(client, options);
}
