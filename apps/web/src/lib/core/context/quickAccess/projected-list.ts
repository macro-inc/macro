import { fireAndForget } from '@core/util/fireAndForget';
import type {
  CacheHost,
  SearchCursor,
  SearchDocumentWire,
} from '@graphql-cache/index';
import {
  isOwnerEpochLostError,
  isOwnerHandoffBlockedError,
} from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { Bucket } from './types';

// Only these buckets can be materialized from cache hits. Other Quick Access
// sources (such as sessions) are merged locally. Personal contacts use their
// separate bounded, context-ranked window rather than this generic projection.
const PROJECTED_BUCKETS: ReadonlySet<Bucket> = new Set([
  'document',
  'note',
  'task',
  'snippet',
  'skill',
  'chat',
  'project',
  'email',
  'channel',
  'dm',
  'crm_company',
  'crm_contact',
  'initiative',
]);
const BROWSE_PAGE_SIZE = 50;
const SEARCH_LIMIT = 500;
/** Maximum cache pages inspected by one initial browse or load-more action. */
export const MAX_BROWSE_PAGES_PER_LOAD = 4;
/**
 * How long a search the cache has not answered keeps reporting as pending.
 * It outlasts the host's own wait for an owner change (its one-second read
 * budget plus the read timeout a held search gets), so a search the host gave
 * up on stops by then and an owner change that never completes still ends.
 */
export const UNANSWERED_SEARCH_LIMIT_MS = 12_000;

type Request = {
  buckets: Bucket[];
  query: string;
  pages: number;
  cursor?: SearchCursor;
  busy: boolean;
  refreshPending: boolean;
  answered: boolean;
  awaitingEngine: boolean;
  /** Tells the host to stop holding this search once another replaces it. */
  superseded: AbortController;
  giveUpTimer?: ReturnType<typeof setTimeout>;
};

function isRefusedFirstAnswer(request: Request, error: unknown): boolean {
  // Either way the cache was changing owner and a replacement engine follows.
  const ownerChanging =
    isOwnerHandoffBlockedError(error) || isOwnerEpochLostError(error);
  return !request.answered && ownerChanging;
}

/** A paginated, cache-only search. Refreshes replay the loaded browse window
 * rather than shrinking a scrolled list back to its first page. */
export function createProjectedList<T extends { id: string }>(options: {
  host: Pick<CacheHost, 'search'> &
    Partial<Pick<CacheHost, 'onCacheGenerationChanged'>>;
  /** A reactive getter can change the allowed buckets as feature flags load. */
  buckets: readonly Bucket[];
  revision: Accessor<number>;
  searchTerm?: Accessor<string>;
  enabled?: Accessor<boolean>;
  /** Visible fallback rows; duplicates do not grow the combined menu. */
  existingItems?: Accessor<readonly T[]>;
  /** Snapshot of source availability; reading it must not trigger a new request. */
  sourceAttributes?: Accessor<Record<string, number>>;
  /** Keep already-materialized matches visible while a new query is pending. */
  filterPreviousItems?: (items: T[], query: string) => T[];
  materialize: (documents: SearchDocumentWire[]) => Promise<T[]>;
}) {
  const buckets = () => {
    const requested = options.buckets;
    return requested.length === 0
      ? [...PROJECTED_BUCKETS]
      : requested.filter((bucket) => PROJECTED_BUCKETS.has(bucket));
  };
  const [items, setItems] = createSignal<T[]>([]);
  const [hasMore, setHasMore] = createSignal(false);
  const [loading, setLoading] = createSignal<'idle' | 'initial' | 'more'>(
    untrack(() =>
      options.enabled?.() !== false && buckets().length > 0 ? 'initial' : 'idle'
    )
  );
  const [error, setError] = createSignal<unknown>();
  // True from a new query or bucket set until its first answer, unlike
  // `loading`, which also covers replays of a window already on screen.
  const [searching, setSearching] = createSignal(
    untrack(loading) === 'initial'
  );
  let current: Request | undefined;
  let engineReplacements = 0;
  const retire = (request: Request | undefined) => {
    request?.superseded.abort();
    clearTimeout(request?.giveUpTimer);
  };
  onCleanup(() => {
    retire(current);
    current = undefined;
  });

  // The search stays pending and the replacement engine still replays it
  // whenever it arrives; this only stops telling the user that an answer is
  // on its way. It runs from the start of the attempt because a host that is
  // waiting for an owner has paused its own read timeouts.
  const stopWaitingAtLimit = (request: Request) => {
    clearTimeout(request.giveUpTimer);
    request.giveUpTimer = setTimeout(() => {
      if (current === request && !request.answered) setSearching(false);
    }, UNANSWERED_SEARCH_LIMIT_MS);
  };

  const finishRequest = (request: Request) => {
    if (current !== request) return;
    request.busy = false;
    // A read refused while the cache moves between owners is replayed when
    // the replacement engine arrives, so the query is still unanswered.
    if (!request.awaitingEngine) setSearching(false);
    if (request.refreshPending) {
      // Publish the completed window before replaying changes received during
      // search/materialization (or a load-more operation).
      fireAndForget(fetchPages(request, request.pages, false), 'quick-access');
    } else {
      setLoading('idle');
    }
  };

  const fetchPages = async (
    request: Request,
    pageCount: number,
    append: boolean
  ) => {
    request.busy = true;
    request.refreshPending = false;
    setLoading(append ? 'more' : 'initial');
    if (!request.answered) {
      setSearching(true);
      stopWaitingAtLimit(request);
    }
    const previous = append ? untrack(items) : [];
    const merged = new Map(previous.map((item) => [item.id, item]));
    const visibleIds = new Set([
      ...merged.keys(),
      ...(append
        ? untrack(() => options.existingItems?.() ?? []).map((item) => item.id)
        : []),
    ]);
    // Refreshes may replay a window the user already loaded, but never scan
    // beyond that window without the same bounded budget as a new browse.
    const pageBudget = Math.max(pageCount, MAX_BROWSE_PAGES_PER_LOAD);
    let fetchedPages = 0;
    let foundNewRow = false;
    let cursor = append ? request.cursor : undefined;
    let pages = append ? request.pages : 0;
    const replacementsAtStart = engineReplacements;
    const span = Telemetry.span('quick_access.search');
    span.setAttr('search.buckets', request.buckets.join(','));
    span.setAttr('search.query_length', request.query.length);
    span.setAttr('search.append', append);
    span.setAttr('search.refresh', !append && request.answered);
    try {
      for (const [key, value] of Object.entries(
        untrack(() => options.sourceAttributes?.() ?? {})
      )) {
        span.setAttr(key, value);
      }
      do {
        const page = await span.span(
          'quick_access.search_page',
          async (span) => {
            span.setAttr('search.buckets', request.buckets.join(','));
            span.setAttr('search.query_length', request.query.length);
            const result = await options.host.search(
              {
                profile: 'quick-access-v1',
                buckets: request.buckets,
                query: request.query,
                limit: request.query ? SEARCH_LIMIT : BROWSE_PAGE_SIZE,
                ...(cursor ? { cursor } : {}),
              },
              { signal: request.superseded.signal }
            );
            span.setAttr('search.result_count', result.documents.length);
            return result;
          }
        );
        if (current !== request) return;
        const materialized = await span.span(
          'quick_access.materialize',
          async (span) => {
            span.setAttr('search.result_count', page.documents.length);
            return options.materialize(page.documents);
          }
        );
        if (current !== request) return;
        for (const item of materialized) {
          merged.set(item.id, item);
          if (!visibleIds.has(item.id)) foundNewRow = true;
        }
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        fetchedPages += 1;
        pageCount -= 1;
        // Skip incomplete/duplicate pages only within this action's budget.
        // Retain the continuation even if no visible row was found.
      } while (
        cursor &&
        fetchedPages < pageBudget &&
        (pageCount > 0 || !foundNewRow)
      );
      span.setAttr('search.page_count', fetchedPages);
      span.setAttr('search.materialized_count', merged.size);
      request.cursor = cursor;
      request.pages = pages;
      request.answered = true;
      request.awaitingEngine = false;
      setError(undefined);
      setItems([...merged.values()]);
      setHasMore(cursor !== undefined);
    } catch (error) {
      if (current !== request) return;
      span.error('Quick Access cache search failed');
      request.awaitingEngine = isRefusedFirstAnswer(request, error);
      setError(error);
      // Rows and their continuation are a committed window. A failed replay
      // (or append) must leave both intact so normal pagination can retry.
      // The mentions page loader guards automatic retries at the same frontier.
      setHasMore(request.cursor !== undefined);
      console.warn('Quick Access cache search failed', error);
    } finally {
      span.setAttr(
        'search.engine_restarted',
        engineReplacements !== replacementsAtStart
      );
      span.end();
      finishRequest(request);
    }
  };

  // Nothing else replays a refused first answer: cache-change refreshes only
  // follow a write, and the menu would list no documents until one happened.
  const stopWatchingEngine = options.host.onCacheGenerationChanged?.(() => {
    engineReplacements += 1;
    // The host reports the replacement before it starts reinitializing, so
    // read after the notification returns.
    queueMicrotask(() => {
      const request = current;
      if (!request?.awaitingEngine) return;

      if (request.busy) request.refreshPending = true;
      else
        fireAndForget(
          fetchPages(request, request.pages, false),
          'quick-access'
        );
    });
  });
  onCleanup(() => stopWatchingEngine?.());

  createEffect(() => {
    options.revision();
    const query = options.searchTerm?.().trim() ?? '';
    const activeBuckets = buckets();
    const enabled = options.enabled?.() !== false && activeBuckets.length > 0;
    const previous = current;
    if (
      enabled &&
      previous?.query === query &&
      previous.buckets.length === activeBuckets.length &&
      previous.buckets.every((bucket, index) => bucket === activeBuckets[index])
    ) {
      // A cache revision is not a new search. Replacing an in-flight request
      // here starves results when hydration is faster than cache reads.
      if (previous.busy) previous.refreshPending = true;
      else
        fireAndForget(
          fetchPages(previous, previous.pages, false),
          'quick-access'
        );
      return;
    }

    // Genuine query/bucket changes, disabling, and disposal still fence off
    // obsolete responses and their queued refreshes.
    retire(previous);
    current = undefined;
    setError(undefined);
    setHasMore(false);
    const sameBuckets =
      previous?.buckets.length === activeBuckets.length &&
      previous.buckets.every(
        (bucket, index) => bucket === activeBuckets[index]
      );
    setItems(
      enabled && sameBuckets
        ? (options.filterPreviousItems?.(untrack(items), query) ?? [])
        : []
    );
    setSearching(enabled);
    if (!enabled) {
      setLoading('idle');
      return;
    }
    const request: Request = {
      buckets: activeBuckets,
      query,
      pages: 1,
      busy: false,
      refreshPending: false,
      answered: false,
      awaitingEngine: false,
      superseded: new AbortController(),
    };
    current = request;
    fireAndForget(fetchPages(request, request.pages, false), 'quick-access');
  });

  return {
    items,
    error,
    hasMore,
    isLoading: () => loading() === 'initial',
    isSearching: searching,
    isLoadingMore: () => loading() === 'more',
    loadMore: async () => {
      const request = current;
      if (!request || request.busy || !request.cursor) return;
      await fetchPages(request, 1, true);
    },
  };
}
