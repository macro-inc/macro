import {
  type AnyVariables,
  type Client,
  type CombinedError,
  createRequest,
  type OperationContext,
  type OperationResult,
} from '@urql/core';
import type { UrqlObserver } from './observer';
import { QueryObserver } from './query-observer';
import type {
  UrqlInfiniteData,
  UrqlInfiniteQueryOptions,
  UrqlInfiniteQueryResult,
  UrqlQueryOptions,
  UrqlQueryRefetchOptions,
} from './types';
import { getQueryStatus, ObserverResult, toCombinedError } from './utils';

type InfiniteOptions<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData,
> = UrqlInfiniteQueryOptions<PageData, Variables, PageParam, SelectedData>;

type InfiniteResult<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData,
> = UrqlInfiniteQueryResult<PageData, Variables, PageParam, SelectedData>;

type Page<PageData, Variables extends AnyVariables, PageParam> = {
  pageIndex: number;
  pageParam: PageParam;
  variables: Variables;
  observer: QueryObserver<PageData, Variables>;
  unsubscribe: () => void;
};

type InfiniteQueryKey<PageParam> = {
  key: number;
  initialPageParam: PageParam;
  requestPolicy: unknown;
  context: Partial<OperationContext> | undefined;
};

type InfiniteQueryObserverState<SelectedData> = {
  previousData: SelectedData | undefined;
  enabled: boolean;
  fetchingNextPage: boolean;
  refetching: boolean;
  paginationError: CombinedError | undefined;
};

type NextPageParamResult<PageParam> = {
  pageParam: PageParam | null | undefined;
  error: CombinedError | null;
};

function shallowEqualContext(
  left: Partial<OperationContext> | undefined,
  right: Partial<OperationContext> | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left) as (keyof OperationContext)[];
  const rightKeys = Object.keys(right) as (keyof OperationContext)[];
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function sameQuery<PageParam>(
  left: InfiniteQueryKey<PageParam> | undefined,
  right: InfiniteQueryKey<PageParam>
): boolean {
  return (
    left !== undefined &&
    left.key === right.key &&
    Object.is(left.initialPageParam, right.initialPageParam) &&
    left.requestPolicy === right.requestPolicy &&
    shallowEqualContext(left.context, right.context)
  );
}

/** Observer for a paginated set of live urql queries. */
export class InfiniteQueryObserver<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData = UrqlInfiniteData<PageData, PageParam>,
> implements
    UrqlObserver<
      InfiniteOptions<PageData, Variables, PageParam, SelectedData>,
      InfiniteResult<PageData, Variables, PageParam, SelectedData>
    >
{
  private client: Client;
  private options: InfiniteOptions<
    PageData,
    Variables,
    PageParam,
    SelectedData
  >;
  private queryKey: InfiniteQueryKey<PageParam> | undefined;
  private readonly pages: Page<PageData, Variables, PageParam>[] = [];
  private state: InfiniteQueryObserverState<SelectedData> = {
    previousData: undefined,
    enabled: true,
    fetchingNextPage: false,
    refetching: false,
    paginationError: undefined,
  };
  private failedNextPage: Page<PageData, Variables, PageParam> | undefined;
  private currentResult!: InfiniteResult<
    PageData,
    Variables,
    PageParam,
    SelectedData
  >;
  private readonly result = new ObserverResult(() => this.getCurrentResult());
  private actionController = new AbortController();
  private destroyed = false;
  private fetchNextPromise:
    | Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>>
    | undefined;
  private refetchPromise:
    | Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>>
    | undefined;

  constructor(
    client: Client,
    options: InfiniteOptions<PageData, Variables, PageParam, SelectedData>
  ) {
    this.client = client;
    this.options = options;
    this.currentResult = this.buildResult();
    this.applyOptions(options, client);
  }

  getCurrentResult(): InfiniteResult<
    PageData,
    Variables,
    PageParam,
    SelectedData
  > {
    return this.currentResult;
  }

  private buildResult(): InfiniteResult<
    PageData,
    Variables,
    PageParam,
    SelectedData
  > {
    const infiniteData = this.successfulPages();
    let data = this.state.previousData;
    let derivationError: CombinedError | null = null;

    if (infiniteData.pages.length > 0) {
      try {
        data = this.options.select
          ? this.options.select(infiniteData)
          : (infiniteData as SelectedData);
      } catch (cause) {
        derivationError = toCombinedError(cause);
      }
    }

    const pageResults = this.pages.map((page) =>
      page.observer.getCurrentResult()
    );
    const pageError = pageResults.find((page) => page.error)?.error ?? null;
    const fetching = pageResults.some((page) => page.fetching);
    const stale = pageResults.some((page) => page.stale);
    const pageIsFetching = pageResults.some((page) => page.isFetching);
    const fetched =
      pageResults.some((page) => page.isFetched) ||
      this.state.previousData !== undefined;
    let nextPageParam: PageParam | null | undefined;

    if (!derivationError) {
      const nextPage = this.resolveNextPageParam(infiniteData);
      nextPageParam = nextPage.pageParam;
      derivationError = nextPage.error;
    }

    const error = this.state.paginationError ?? derivationError ?? pageError;
    const hasNextPage =
      !this.state.paginationError &&
      !derivationError &&
      nextPageParam !== null &&
      nextPageParam !== undefined;
    const isFetching =
      pageIsFetching || this.state.fetchingNextPage || this.state.refetching;
    const status = getQueryStatus(error, fetched);

    return {
      data,
      error,
      fetching,
      stale,
      status,
      fetchStatus: isFetching ? 'fetching' : 'idle',
      isPending: status === 'pending',
      isLoading: status === 'pending' && isFetching,
      isInitialLoading: status === 'pending' && isFetching,
      isFetching,
      isRefetching:
        this.state.refetching ||
        (fetched && !this.state.fetchingNextPage && pageIsFetching),
      isSuccess: status === 'success',
      isError: status === 'error',
      isEnabled: this.state.enabled,
      isFetched: fetched,
      hasNextPage,
      isFetchingNextPage: this.state.fetchingNextPage,
      isFetchNextPageError:
        this.state.paginationError !== undefined ||
        this.failedNextPage !== undefined,
      resetToInitialPage: this.resetToInitialPage,
      fetchNextPage: this.fetchNextPage,
      refetch: this.refetch,
    };
  }

  setReference(
    result: InfiniteResult<PageData, Variables, PageParam, SelectedData>
  ): void {
    this.result.setReference(result);
  }

  setOptions(
    options: InfiniteOptions<PageData, Variables, PageParam, SelectedData>,
    client: Client
  ): void {
    if (this.destroyed) return;
    this.applyOptions(options, client);
  }

  subscribe(
    listener: (
      result: InfiniteResult<PageData, Variables, PageParam, SelectedData>
    ) => void
  ): () => void {
    return this.result.subscribe(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelActions();
    this.destroyPages();
    this.result.clear();
  }

  readonly resetToInitialPage = (): void => {
    if (this.destroyed) return;

    this.cancelActions();
    this.destroyPages(1);
    this.setState({ paginationError: undefined });
    this.emit();
  };

  readonly fetchNextPage = (
    refetchOptions: UrqlQueryRefetchOptions = {}
  ): Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>> => {
    if (this.fetchNextPromise) return this.fetchNextPromise;

    const signal = this.actionController.signal;
    const pendingRefetch = this.refetchPromise;
    const action = pendingRefetch
      ? pendingRefetch.then(() => this.runFetchNextPage(refetchOptions, signal))
      : this.runFetchNextPage(refetchOptions, signal);
    const trackedAction = action.finally(() => {
      if (this.fetchNextPromise === trackedAction) {
        this.fetchNextPromise = undefined;
      }
    });

    this.fetchNextPromise = trackedAction;

    return trackedAction;
  };

  readonly refetch = (
    refetchOptions: UrqlQueryRefetchOptions = {}
  ): Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>> => {
    if (this.refetchPromise) return this.refetchPromise;

    const signal = this.actionController.signal;
    const pendingFetchNext = this.fetchNextPromise;
    const action = pendingFetchNext
      ? pendingFetchNext.then(() => this.runRefetch(refetchOptions, signal))
      : this.runRefetch(refetchOptions, signal);
    const trackedAction = action.finally(() => {
      if (this.refetchPromise === trackedAction) {
        this.refetchPromise = undefined;
      }
    });

    this.refetchPromise = trackedAction;

    return trackedAction;
  };

  private applyOptions(
    options: InfiniteOptions<PageData, Variables, PageParam, SelectedData>,
    client: Client
  ): void {
    const wasEnabled = this.state.enabled;
    const previousResult = this.getCurrentResult();
    this.options = options;
    this.client = client;

    if (options.enabled === false) {
      this.cancelActions();
      this.setState({ enabled: false });

      for (const page of this.pages) {
        page.observer.setOptions(this.pageOptions(page, false), client);
      }
      this.emit();
      return;
    }

    const initialVariables = options.variables(options.initialPageParam, 0);
    const request = createRequest<PageData, Variables>(
      options.query,
      initialVariables
    );
    const queryKey: InfiniteQueryKey<PageParam> = {
      key: request.key,
      initialPageParam: options.initialPageParam,
      requestPolicy: options.requestPolicy,
      context: options.context,
    };
    const queryChanged = !sameQuery(this.queryKey, queryKey);

    if (queryChanged) {
      this.cancelActions();
      this.setState({
        previousData:
          options.keepPreviousData !== false ? previousResult.data : undefined,
        paginationError: undefined,
      });
      this.queryKey = queryKey;
      this.destroyPages();
    }

    this.setState({ enabled: true });
    if (this.pages.length === 0) {
      this.appendPage(options.initialPageParam, 0, initialVariables);
    } else if (!wasEnabled) {
      for (const page of this.pages) {
        page.observer.setOptions(this.pageOptions(page, true), client);
      }
    }
    this.emit();
  }

  private pageOptions(
    page: Pick<
      Page<PageData, Variables, PageParam>,
      'pageIndex' | 'pageParam' | 'variables'
    >,
    enabled: boolean
  ): UrqlQueryOptions<PageData, Variables> {
    return {
      query: this.options.query,
      variables: page.variables,
      client: this.client,
      enabled,
      requestPolicy: this.options.requestPolicy,
      context: this.options.context,
      keepPreviousData: true,
      onResult: (result: OperationResult<PageData, Variables>) =>
        this.options.onResult?.(result, {
          pageIndex: page.pageIndex,
          pageParam: page.pageParam,
        }),
    };
  }

  private appendPage(
    pageParam: PageParam,
    pageIndex: number,
    variables = this.options.variables(pageParam, pageIndex),
    executeImmediately = true
  ): Page<PageData, Variables, PageParam> {
    const descriptor = { pageIndex, pageParam, variables };
    const observer = new QueryObserver<PageData, Variables>(
      this.client,
      this.pageOptions(descriptor, this.state.enabled),
      executeImmediately
    );
    const page: Page<PageData, Variables, PageParam> = {
      ...descriptor,
      observer,
      unsubscribe: () => undefined,
    };
    page.unsubscribe = observer.subscribe(() => this.handlePageUpdate(page));

    this.pages.push(page);
    this.emit();

    return page;
  }

  private handlePageUpdate(page: Page<PageData, Variables, PageParam>): void {
    const result = page.observer.getCurrentResult();

    if (
      this.failedNextPage === page &&
      result.isFetched &&
      !result.isFetching &&
      !result.error
    ) {
      this.failedNextPage = undefined;
    }

    this.emit();
  }

  private cancelActions(): void {
    this.actionController.abort();
    this.actionController = new AbortController();
    this.fetchNextPromise = undefined;
    this.refetchPromise = undefined;
    this.failedNextPage = undefined;
    this.setState({
      fetchingNextPage: false,
      refetching: false,
    });
  }

  private destroyPages(fromIndex = 0): void {
    const removed = this.pages.splice(fromIndex);
    for (const page of removed) {
      page.unsubscribe();
      page.observer.destroy();
    }
  }

  private successfulPages(
    pages = this.pages
  ): UrqlInfiniteData<PageData, PageParam> {
    const data: PageData[] = [];
    const pageParams: PageParam[] = [];
    for (const page of pages) {
      const result = page.observer.getCurrentResult();
      if (result.data !== undefined) {
        data.push(result.data);
        pageParams.push(page.pageParam);
      }
    }
    return { pages: data, pageParams };
  }

  private resolveNextPageParam(
    data = this.successfulPages()
  ): NextPageParamResult<PageParam> {
    const lastPage = data.pages.at(-1);
    if (lastPage === undefined || data.pageParams.length === 0) {
      return { pageParam: undefined, error: null };
    }

    const lastPageParam = data.pageParams[
      data.pageParams.length - 1
    ] as PageParam;

    try {
      return {
        pageParam: this.options.getNextPageParam(
          lastPage,
          data.pages,
          lastPageParam,
          data.pageParams
        ),
        error: null,
      };
    } catch (cause) {
      return { pageParam: undefined, error: toCombinedError(cause) };
    }
  }

  private async runFetchNextPage(
    refetchOptions: UrqlQueryRefetchOptions,
    signal: AbortSignal
  ): Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>> {
    if (signal.aborted || this.destroyed || !this.state.enabled) {
      return this.actionResult();
    }

    const nextPage = this.resolveNextPageParam();

    if (nextPage.error) {
      this.setState({ paginationError: nextPage.error });
      this.emit();

      if (refetchOptions.throwOnError) throw nextPage.error;

      return this.actionResult();
    }

    const pageParam = nextPage.pageParam;
    if (pageParam === null || pageParam === undefined) {
      return this.actionResult();
    }

    const existing = this.pages.find(
      (page) =>
        Object.is(page.pageParam, pageParam) &&
        page.observer.getCurrentResult().data === undefined
    );
    const duplicate = this.pages.some(
      (page) => Object.is(page.pageParam, pageParam) && page !== existing
    );

    if (duplicate) {
      const error = toCombinedError(
        new Error('infinite query returned a repeated page parameter')
      );

      this.setState({ paginationError: error });
      this.emit();

      if (refetchOptions.throwOnError) throw error;

      return this.actionResult();
    }

    this.failedNextPage = undefined;
    this.setState({ fetchingNextPage: true });
    this.emit();

    const page =
      existing ??
      this.appendPage(pageParam, this.pages.length, undefined, false);

    try {
      await page.observer.refetch(refetchOptions);

      if (signal.aborted) return this.actionResult();

      const error = page.observer.getCurrentResult().error;

      this.failedNextPage = error ? page : undefined;
      this.emit();

      return this.actionResult();
    } catch (cause) {
      if (signal.aborted) return this.actionResult();

      this.failedNextPage = page;
      this.emit();

      throw cause;
    } finally {
      if (!signal.aborted) {
        this.setState({ fetchingNextPage: false });
        this.emit();
      }
    }
  }

  private async runRefetch(
    refetchOptions: UrqlQueryRefetchOptions,
    signal: AbortSignal
  ): Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>> {
    if (signal.aborted || this.destroyed || !this.state.enabled) {
      return this.actionResult();
    }

    const targetPageCount = Math.max(1, this.pages.length);

    this.failedNextPage = undefined;
    this.setState({
      refetching: true,
      paginationError: undefined,
    });
    this.emit();

    try {
      if (this.pages.length === 0) {
        const firstPage = this.appendPage(
          this.options.initialPageParam,
          0,
          undefined,
          false
        );

        await firstPage.observer.refetch(refetchOptions);
      } else {
        await this.pages[0]?.observer.refetch(refetchOptions);
      }

      if (signal.aborted) return this.actionResult();

      for (let pageIndex = 1; pageIndex < targetPageCount; pageIndex += 1) {
        if (signal.aborted || this.destroyed || !this.state.enabled) break;

        const previousData = this.successfulPages(
          this.pages.slice(0, pageIndex)
        );

        if (previousData.pages.length !== pageIndex) {
          this.destroyPages(pageIndex);
          break;
        }

        const nextPage = this.resolveNextPageParam(previousData);

        if (nextPage.error) {
          this.setState({ paginationError: nextPage.error });
          this.emit();
          if (refetchOptions.throwOnError) throw nextPage.error;
          break;
        }

        const expectedPageParam = nextPage.pageParam;
        if (expectedPageParam === null || expectedPageParam === undefined) {
          this.destroyPages(pageIndex);
          break;
        }

        let page = this.pages[pageIndex];

        if (!page || !Object.is(page.pageParam, expectedPageParam)) {
          this.destroyPages(pageIndex);
          page = this.appendPage(
            expectedPageParam,
            pageIndex,
            undefined,
            false
          );
        }

        await page.observer.refetch(refetchOptions);
      }

      return this.actionResult();
    } catch (cause) {
      if (signal.aborted) return this.actionResult();
      throw cause;
    } finally {
      if (!signal.aborted) {
        this.setState({ refetching: false });
        this.emit();
      }
    }
  }

  private setState(
    nextState: Partial<InfiniteQueryObserverState<SelectedData>>
  ): void {
    this.state = { ...this.state, ...nextState };
  }

  private actionResult(): InfiniteResult<
    PageData,
    Variables,
    PageParam,
    SelectedData
  > {
    return this.result.getActionResult();
  }

  private emit(): void {
    this.currentResult = this.buildResult();
    this.result.notify();
  }
}

/** Creates an observer for {@link createUrqlInfiniteQuery}. */
export function createInfiniteQueryObserver<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData = UrqlInfiniteData<PageData, PageParam>,
>(
  client: Client,
  options: InfiniteOptions<PageData, Variables, PageParam, SelectedData>
): InfiniteQueryObserver<PageData, Variables, PageParam, SelectedData> {
  return new InfiniteQueryObserver(client, options);
}
