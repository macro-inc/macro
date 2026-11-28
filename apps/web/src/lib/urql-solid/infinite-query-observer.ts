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
import {
  createReactiveSelection,
  type ReactiveSelection,
} from './reactive-selection';
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
  /** A continuation page that failed to refetch; its stale rows stay mounted. */
  refetchError: CombinedError | undefined;
  /** Continuation pages are being read again from the cursors that follow. */
  repairing: boolean;
  /** A repair read that failed; its stale page stays mounted. */
  repairError: CombinedError | undefined;
};

type NextPageParamResult<PageParam> = {
  pageParam: PageParam | null | undefined;
  error: CombinedError | null;
};

type ContinuationCheck<PageParam> =
  | { kind: 'holds' }
  | { kind: 'unknown' }
  | {
      kind: 'broken';
      pageIndex: number;
      pageParam: PageParam | null | undefined;
    };

/** What a replacement page must show before it takes the stale page's place. */
type ReplacementCheck = {
  /** A response that carries an error too keeps the stale page. */
  complete?: boolean;
  /** The replacement is still the page the chain wants there. */
  current?: () => boolean;
};

/**
 * How a repair pass ended: the chain checked, a page behind it moved, a read
 * failed, or it was stopped.
 */
type RepairPassEnd = 'done' | 'moved' | 'failed' | 'stopped';

/**
 * A pass that a moving page cut short waits before the next one, longer each
 * time it keeps moving, so the reads that move it get their turn.
 */
const REPAIR_PAUSE_MIN_MS = 250;
const REPAIR_PAUSE_MAX_MS = 8_000;

type ReplaceOutcome =
  | { kind: 'replaced' }
  | { kind: 'failed'; error: CombinedError | undefined }
  | { kind: 'outdated' }
  | { kind: 'cancelled' };

type SelectionCache<PageData, PageParam, SelectedData> = {
  pages: readonly PageData[];
  pageParams: readonly PageParam[];
  select: InfiniteOptions<
    PageData,
    AnyVariables,
    PageParam,
    SelectedData
  >['select'];
  previousData: SelectedData | undefined;
  selection: ReactiveSelection<SelectedData>;
};

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]))
  );
}

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
    refetchError: undefined,
    repairing: false,
    repairError: undefined,
  };
  private failedNextPage: Page<PageData, Variables, PageParam> | undefined;
  private currentResult!: InfiniteResult<
    PageData,
    Variables,
    PageParam,
    SelectedData
  >;
  private readonly result = new ObserverResult(() => this.getCurrentResult());
  // Keep selector scopes across status-only emissions. Live field dependencies
  // invalidate the selection even when its page references remain unchanged.
  private selectionCache:
    | SelectionCache<PageData, PageParam, SelectedData>
    | undefined;
  private emissionBatchDepth = 0;
  private pendingEmission = false;
  private actionController = new AbortController();
  private destroyed = false;
  private fetchNextPromise:
    | Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>>
    | undefined;
  private refetchPromise:
    | Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>>
    | undefined;
  private repairController = new AbortController();
  private repairPromise: Promise<void> | undefined;
  private repairPause: ReturnType<typeof setTimeout> | undefined;
  private repairPauseMs = 0;
  /**
   * A repair read failed; the next page update, or turning repairs on again,
   * tries again.
   */
  private repairWaitsForPage = false;

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
    const selection = this.deriveSelectedData(infiniteData);
    const data = selection.data;
    let derivationError = selection.error;

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

    const error =
      this.state.paginationError ??
      derivationError ??
      pageError ??
      this.chainError() ??
      null;
    const hasNextPage =
      !this.state.paginationError &&
      !derivationError &&
      nextPageParam !== null &&
      nextPageParam !== undefined;
    const isFetching =
      pageIsFetching || this.state.fetchingNextPage || this.rereadingChain();
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
        this.rereadingChain() ||
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

  private deriveSelectedData(
    infiniteData: UrqlInfiniteData<PageData, PageParam>
  ): { data: SelectedData | undefined; error: CombinedError | null } {
    if (infiniteData.pages.length === 0) {
      this.selectionCache?.selection.dispose();
      this.selectionCache = undefined;
      return { data: this.state.previousData, error: null };
    }

    const select = this.options.select;
    const cached = this.selectionCache;
    if (
      cached !== undefined &&
      cached.select === select &&
      Object.is(cached.previousData, this.state.previousData) &&
      sameReferences(cached.pages, infiniteData.pages) &&
      sameReferences(cached.pageParams, infiniteData.pageParams)
    ) {
      const selected = cached.selection.current();
      return {
        ...selected,
        data:
          selected.error && selected.data === undefined
            ? this.state.previousData
            : selected.data,
      };
    }

    cached?.selection.dispose();
    const selection = createReactiveSelection(
      () => (select ? select(infiniteData) : (infiniteData as SelectedData)),
      () => {
        if (!this.destroyed) this.emit();
      }
    );

    this.selectionCache = {
      pages: infiniteData.pages,
      pageParams: infiniteData.pageParams,
      select,
      previousData: this.state.previousData,
      selection,
    };

    const selected = selection.current();
    return {
      ...selected,
      data:
        selected.error && selected.data === undefined
          ? this.state.previousData
          : selected.data,
    };
  }

  /** Loaded pages are being read again by a refetch or a repair. */
  private rereadingChain(): boolean {
    return this.state.refetching || this.state.repairing;
  }

  /** A failed read of a continuation page whose stale rows stay mounted. */
  private chainError(): CombinedError | undefined {
    return this.state.refetchError ?? this.state.repairError;
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
    this.selectionCache?.selection.dispose();
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
    // A repair can drop the pages a next page would follow.
    const action = runAfter(this.refetchPromise ?? this.repairPromise, () =>
      this.runFetchNextPage(refetchOptions, signal)
    );
    const trackedAction = action.finally(() => {
      if (this.fetchNextPromise === trackedAction) {
        this.fetchNextPromise = undefined;
        this.repairContinuations();
      }
    });

    this.fetchNextPromise = trackedAction;

    return trackedAction;
  };

  readonly refetch = (
    refetchOptions: UrqlQueryRefetchOptions = {}
  ): Promise<InfiniteResult<PageData, Variables, PageParam, SelectedData>> => {
    if (this.refetchPromise) return this.refetchPromise;

    // The refetch rebuilds the whole cursor chain, so a repair has nothing left.
    this.stopRepair();
    const signal = this.actionController.signal;
    const action = runAfter(this.fetchNextPromise, () =>
      this.runRefetch(refetchOptions, signal)
    );
    const trackedAction = action.finally(() => {
      if (this.refetchPromise === trackedAction) {
        this.refetchPromise = undefined;
        this.repairContinuations();
      }
    });

    this.refetchPromise = trackedAction;

    return trackedAction;
  };

  private applyOptions(
    options: InfiniteOptions<PageData, Variables, PageParam, SelectedData>,
    client: Client
  ): void {
    this.batchEmissions(() => {
      const wasEnabled = this.state.enabled;
      const previousResult = this.getCurrentResult();
      // Turning repairs on again tries a failed one again; applying the same
      // options does not.
      if (options.repairContinuations && !this.options.repairContinuations)
        this.repairWaitsForPage = false;
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
            options.keepPreviousData !== false
              ? previousResult.data
              : undefined,
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
      this.repairContinuations();
    });
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

  private createPage(
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

    return page;
  }

  private appendPage(
    pageParam: PageParam,
    pageIndex: number,
    variables = this.options.variables(pageParam, pageIndex),
    executeImmediately = true
  ): Page<PageData, Variables, PageParam> {
    const page = this.createPage(
      pageParam,
      pageIndex,
      variables,
      executeImmediately
    );

    this.pages.push(page);
    this.emit();

    return page;
  }

  private destroyPage(page: Page<PageData, Variables, PageParam>): void {
    if (page === this.failedNextPage) this.failedNextPage = undefined;
    page.unsubscribe();
    page.observer.destroy();
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

    this.repairWaitsForPage = false;
    this.emit();
    this.repairContinuations();
  }

  private cancelActions(): void {
    this.actionController.abort();
    this.actionController = new AbortController();
    this.stopRepair();
    this.fetchNextPromise = undefined;
    this.refetchPromise = undefined;
    this.failedNextPage = undefined;
    this.setState({
      fetchingNextPage: false,
      refetching: false,
      refetchError: undefined,
    });
  }

  private stopRepair(): void {
    this.repairController.abort();
    this.repairController = new AbortController();
    this.repairPromise = undefined;
    clearTimeout(this.repairPause);
    this.repairPause = undefined;
    this.repairPauseMs = 0;
    this.repairWaitsForPage = false;
    this.setState({ repairing: false, repairError: undefined });
  }

  /**
   * With `repairContinuations`, reads a continuation page again from the
   * cursor the page before it now ends at. A read that moves a page's last
   * row, such as a new row pushing it onto the next page, leaves the next
   * page's saved cursor past the rows that now start it, and they would be
   * on no page. A chain that holds reads nothing, and clears the error of a
   * repair that failed before it healed.
   */
  private repairContinuations(): void {
    if (!this.options.repairContinuations && !this.state.repairError) return;
    // A refetch or next page in progress, claimed or not, rebuilds or extends
    // the chain itself; the repair looks again once it settles.
    if (
      this.destroyed ||
      this.state.repairing ||
      this.repairPause !== undefined ||
      this.repairWaitsForPage ||
      this.state.refetching ||
      this.state.fetchingNextPage ||
      this.fetchNextPromise ||
      this.refetchPromise
    )
      return;
    const chain = this.checkContinuations();
    if (chain.kind === 'holds' && this.state.repairError) {
      this.setState({ repairError: undefined });
      this.emit();
    }
    if (
      chain.kind !== 'broken' ||
      !this.options.repairContinuations ||
      !this.state.enabled
    )
      return;
    this.setState({ repairing: true });
    const repair = this.runRepair(this.repairController.signal);
    // A repair that needed no read has already finished and emitted. One
    // that is reading is recorded before anyone hears of it, so a next page
    // asked for meanwhile waits for it.
    if (!this.state.repairing) return;
    this.repairPromise = repair;
    this.emit();
  }

  /**
   * Whether each continuation page's cursor follows the page before it, or
   * the first one that does not. A page without rows or with an error (a
   * partial response can leave out its cursor), or a cursor that fails to
   * resolve, says nothing about the pages after it.
   */
  private checkContinuations(): ContinuationCheck<PageParam> {
    const previous: UrqlInfiniteData<PageData, PageParam> = {
      pages: [],
      pageParams: [],
    };
    for (const [pageIndex, page] of this.pages.entries()) {
      if (pageIndex > 0) {
        const next = this.resolveNextPageParam(previous);
        if (next.error) return { kind: 'unknown' };
        if (!Object.is(page.pageParam, next.pageParam))
          return { kind: 'broken', pageIndex, pageParam: next.pageParam };
      }
      const { data, error } = page.observer.getCurrentResult();
      if (data === undefined || error) return { kind: 'unknown' };
      previous.pages.push(data);
      previous.pageParams.push(page.pageParam);
    }
    return { kind: 'holds' };
  }

  /**
   * The cursor the page before `pageIndex` now ends at, when every page up to
   * it has rows and no error.
   */
  private continuationAt(pageIndex: number): PageParam | null | undefined {
    const previous = this.pages.slice(0, pageIndex);
    const clean = previous.every((page) => {
      const { data, error } = page.observer.getCurrentResult();
      return data !== undefined && !error;
    });
    if (!clean) return undefined;
    return this.resolveNextPageParam(this.successfulPages(previous)).pageParam;
  }

  private async runRepair(signal: AbortSignal): Promise<void> {
    let end: RepairPassEnd = 'stopped';
    try {
      end = await this.repairPass(signal);
    } catch (cause) {
      if (!signal.aborted) {
        end = 'failed';
        this.setState({ repairError: toCombinedError(cause) });
      }
    } finally {
      if (!signal.aborted) {
        this.repairPromise = undefined;
        this.setState({ repairing: false });
        // Decided before anyone hears the query went idle, so a listener
        // that applies options again meanwhile starts no pass.
        this.holdRepair(end);
        this.emit();
      }
    }
  }

  /**
   * After a failed read, waits for a page update before trying again. After
   * a pass a moving page cut short, repairs after a pause, which doubles while
   * each pass is cut short. Page updates during the pause start no pass: the
   * one at its end covers them, and meanwhile the query is idle, so the
   * refresh queue and a queued next page or refetch get their turn.
   */
  private holdRepair(end: RepairPassEnd): void {
    if (end === 'failed') this.repairWaitsForPage = true;
    if (end !== 'moved') {
      this.repairPauseMs = 0;
      return;
    }
    this.repairPauseMs = Math.min(
      REPAIR_PAUSE_MAX_MS,
      Math.max(REPAIR_PAUSE_MIN_MS, this.repairPauseMs * 2)
    );
    this.repairPause = setTimeout(() => {
      this.repairPause = undefined;
      this.repairContinuations();
    }, this.repairPauseMs);
  }

  /**
   * Replaces broken continuations in order, each once, keeping the stale
   * rows until a clean replacement lands, and drops the pages after one that
   * now ends the list. A read whose page has moved on since is dropped,
   * failed or not, and a page behind the pass that moves ends it. A failed
   * read keeps the stale page, reports the error and ends the repair; the
   * next page update tries again.
   */
  private async repairPass(signal: AbortSignal): Promise<RepairPassEnd> {
    let nextIndex = 1;
    let chain = this.checkContinuations();
    while (chain.kind === 'broken') {
      if (
        signal.aborted ||
        this.destroyed ||
        !this.state.enabled ||
        !this.options.repairContinuations
      )
        return 'stopped';
      const { pageIndex, pageParam } = chain;
      if (pageIndex < nextIndex) return 'moved';
      nextIndex = pageIndex + 1;
      if (pageParam === null || pageParam === undefined) {
        this.destroyPages(pageIndex);
        this.emit();
      } else {
        const stale = this.pages[pageIndex];
        const outcome = await this.replacePage(
          pageIndex,
          pageParam,
          { requestPolicy: 'network-only' },
          signal,
          {
            complete: true,
            current: () =>
              this.pages[pageIndex] === stale &&
              Object.is(this.continuationAt(pageIndex), pageParam),
          }
        );
        if (outcome.kind === 'failed') {
          this.setState({ repairError: outcome.error });
          return 'failed';
        }
        if (outcome.kind === 'cancelled') return 'stopped';
      }
      chain = this.checkContinuations();
    }
    if (chain.kind === 'holds') this.setState({ repairError: undefined });
    return 'done';
  }

  private destroyPages(fromIndex = 0): void {
    for (const page of this.pages.splice(fromIndex)) this.destroyPage(page);
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
      refetchError: undefined,
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

        const page = this.pages[pageIndex];

        if (page && Object.is(page.pageParam, expectedPageParam)) {
          await page.observer.refetch(refetchOptions);
        } else if (
          !(await this.replaceForRefetch(
            pageIndex,
            expectedPageParam,
            refetchOptions,
            signal
          ))
        ) {
          break;
        }
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

  /**
   * Fetches the page behind a changed cursor before swapping it in. The stale
   * page it replaces stays mounted until its rows have arrived, so the list
   * keeps its height and the viewport its scroll position. A failed fetch
   * keeps the stale page, and the caller reports its error.
   */
  private async replacePage(
    pageIndex: number,
    pageParam: PageParam,
    refetchOptions: UrqlQueryRefetchOptions,
    signal: AbortSignal,
    check: ReplacementCheck = {}
  ): Promise<ReplaceOutcome> {
    const replacement = this.createPage(pageParam, pageIndex, undefined, false);
    // A cancelled action releases the detached page at once, not when its
    // network result eventually lands.
    const abort = () => this.destroyPage(replacement);
    signal.addEventListener('abort', abort, { once: true });
    let replaced = false;
    try {
      await replacement.observer.refetch(refetchOptions);
      if (signal.aborted || this.destroyed) return { kind: 'cancelled' };
      // A read for a page the chain has moved on from says nothing, even
      // when it failed.
      if (check.current && !check.current()) return { kind: 'outdated' };
      const result = replacement.observer.getCurrentResult();
      if (result.data === undefined || (check.complete && result.error))
        return { kind: 'failed', error: result.error ?? undefined };
      const stale = this.pages[pageIndex];
      this.pages.splice(pageIndex, 1, replacement);
      if (stale) this.destroyPage(stale);
      replaced = true;
      this.emit();
      return { kind: 'replaced' };
    } finally {
      signal.removeEventListener('abort', abort);
      if (!replaced) this.destroyPage(replacement);
    }
  }

  /** Replaces a page for a refetch; a failure ends the refetch's chain. */
  private async replaceForRefetch(
    pageIndex: number,
    pageParam: PageParam,
    refetchOptions: UrqlQueryRefetchOptions,
    signal: AbortSignal
  ): Promise<boolean> {
    const outcome = await this.replacePage(
      pageIndex,
      pageParam,
      refetchOptions,
      signal
    );
    if (outcome.kind === 'failed')
      this.setState({ refetchError: outcome.error });
    return outcome.kind === 'replaced';
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

  private batchEmissions(update: () => void): void {
    this.emissionBatchDepth += 1;
    try {
      update();
    } finally {
      this.emissionBatchDepth -= 1;
      if (this.emissionBatchDepth === 0 && this.pendingEmission) {
        this.pendingEmission = false;
        this.emitNow();
      }
    }
  }

  private emit(): void {
    if (this.emissionBatchDepth > 0) {
      this.pendingEmission = true;
      return;
    }
    this.emitNow();
  }

  private emitNow(): void {
    this.currentResult = this.buildResult();
    this.result.notify();
  }
}

/** Runs `run` now, or once `before` settles, rejecting with its failure. */
function runAfter<T>(
  before: Promise<unknown> | undefined,
  run: () => Promise<T>
): Promise<T> {
  return before ? runAfterSettled(before, run) : run();
}

async function runAfterSettled<T>(
  before: Promise<unknown>,
  run: () => Promise<T>
): Promise<T> {
  await before;
  return run();
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
