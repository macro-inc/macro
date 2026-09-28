import type {
  CacheHost,
  SearchCursor,
  SearchDocumentWire,
} from '@graphql-cache/index';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { Bucket } from './types';

// Only these buckets can be materialized from cache hits. Other Quick Access
// sources (contacts, sessions) are merged locally, after the search limit.
const PROJECTED_BUCKETS: ReadonlySet<Bucket> = new Set([
  'document',
  'note',
  'task',
  'snippet',
  'skill',
  'chat',
  'project',
  'channel',
  'dm',
  'crm_company',
]);
const BROWSE_PAGE_SIZE = 50;
const SEARCH_LIMIT = 500;
/** Maximum cache pages inspected by one initial browse or load-more action. */
export const MAX_BROWSE_PAGES_PER_LOAD = 4;

type Request = {
  buckets: Bucket[];
  query: string;
  pages: number;
  cursor?: SearchCursor;
  busy: boolean;
  refreshPending: boolean;
};

/** A paginated, cache-only search. Refreshes replay the loaded browse window
 * rather than shrinking a scrolled list back to its first page. */
export function createProjectedList<T extends { id: string }>(options: {
  host: Pick<CacheHost, 'search'>;
  /** A reactive getter can change the allowed buckets as feature flags load. */
  buckets: readonly Bucket[];
  revision: Accessor<number>;
  searchTerm?: Accessor<string>;
  enabled?: Accessor<boolean>;
  /** Visible fallback rows; duplicates do not grow the combined menu. */
  existingItems?: Accessor<readonly T[]>;
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
    'idle'
  );
  let current: Request | undefined;
  onCleanup(() => {
    current = undefined;
  });

  const finishRequest = (request: Request) => {
    if (current !== request) return;
    request.busy = false;
    if (request.refreshPending) {
      // Publish the completed window before replaying changes received during
      // search/materialization (or a load-more operation).
      void fetchPages(request, request.pages, false);
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
    try {
      do {
        const page = await options.host.search({
          profile: 'quick-access-v1',
          buckets: request.buckets,
          query: request.query,
          limit: request.query ? SEARCH_LIMIT : BROWSE_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        if (current !== request) return;
        const materialized = await options.materialize(page.documents);
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
      request.cursor = cursor;
      request.pages = pages;
      setItems([...merged.values()]);
      setHasMore(cursor !== undefined);
    } catch (error) {
      if (current !== request) return;
      // Rows and their continuation are a committed window. A failed replay
      // (or append) must leave both intact so normal pagination can retry.
      // The mentions page loader guards automatic retries at the same frontier.
      setHasMore(request.cursor !== undefined);
      console.warn('Quick Access cache search failed', error);
    } finally {
      finishRequest(request);
    }
  };

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
      else void fetchPages(previous, previous.pages, false);
      return;
    }

    // Genuine query/bucket changes, disabling, and disposal still fence off
    // obsolete responses and their queued refreshes.
    current = undefined;
    setHasMore(false);
    setItems([]);
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
    };
    current = request;
    void fetchPages(request, request.pages, false);
  });

  return {
    items,
    hasMore,
    isLoading: () => loading() === 'initial',
    isLoadingMore: () => loading() === 'more',
    loadMore: async () => {
      const request = current;
      if (!request || request.busy || !request.cursor) return;
      await fetchPages(request, 1, true);
    },
  };
}
