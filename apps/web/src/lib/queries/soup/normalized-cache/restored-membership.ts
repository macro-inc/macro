import type { SoupApiItem } from '@service-storage/generated/schemas';
import type {
  InfiniteData,
  Query,
  QueryCache,
  QueryClient,
  QueryKey,
} from '@tanstack/solid-query';
import { getNormalizationObjectKey } from './normalizer';
import { getSoupQueryMeta } from './utils';

type FlatSoupData = InfiniteData<{ items: SoupApiItem[] }, unknown>;
type RetainedItem = { item: SoupApiItem; expiresAt: number };

// Bookkeeping belongs to individual queries, not entity IDs across users or
// filter scopes. Removing a query releases its restores with it.
const caches = new WeakMap<
  QueryCache,
  WeakMap<Query, Map<string, RetainedItem>>
>();
const RETENTION_MS = 5 * 60 * 1000;
const MAX_RESTORED_ITEMS = 200;

function isFlatSoupData(data: unknown): data is FlatSoupData {
  return (
    data !== null &&
    typeof data === 'object' &&
    'pages' in data &&
    Array.isArray(data.pages) &&
    data.pages.length > 0 &&
    data.pages.every((page) => Array.isArray(page?.items))
  );
}

function acceptsItem(query: Query, item: SoupApiItem): boolean {
  const { itemFilter, insertFilter } = getSoupQueryMeta(query.meta);
  return (
    (!itemFilter || itemFilter(item)) && (!insertFilter || insertFilter(item))
  );
}

function restoresForCache(cache: QueryCache) {
  const existing = caches.get(cache);
  if (existing) return existing;

  const queries = new WeakMap<Query, Map<string, RetainedItem>>();
  caches.set(cache, queries);
  cache.subscribe((event) => {
    if (event.type === 'removed') {
      queries.delete(event.query);
      return;
    }
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const retained = queries.get(event.query);
    if (!retained?.size) return;
    const data = event.query.state.data;
    if (!isFlatSoupData(data)) return;

    const present = new Map(
      data.pages.flatMap((page) =>
        page.items.map(
          (item) => [getNormalizationObjectKey(item), item] as const
        )
      )
    );
    const missing: SoupApiItem[] = [];
    for (const [id, entry] of retained) {
      const item = present.get(id);
      if (
        entry.expiresAt <= Date.now() ||
        !acceptsItem(event.query, item ?? entry.item) ||
        (event.action.manual && !item)
      ) {
        // Explicit local removal (done, delete, move) beats an earlier restore.
        retained.delete(id);
      } else if (item) {
        entry.item = item;
      } else {
        missing.push(entry.item);
      }
    }
    if (!missing.length) return;

    // Network success must not drop an admitted row just because a replica
    // still sees it as done. Do not cancel or restart the completed fetch.
    event.query.setData(
      {
        ...data,
        pages: data.pages.map((page, index) =>
          index === 0 ? { ...page, items: [...missing, ...page.items] } : page
        ),
      },
      { manual: true, updatedAt: event.query.state.dataUpdatedAt }
    );
  });
  return queries;
}

/** Protect a just-restored flat Soup row from overlapping stale list results. */
export function retainRestoredSoupItem(
  client: QueryClient,
  key: QueryKey,
  item: SoupApiItem
): void {
  const cache = client.getQueryCache();
  const query = cache.find({ queryKey: key, exact: true });
  const id = getNormalizationObjectKey(item);
  if (!query || !id) return;
  const queries = restoresForCache(cache);
  const retained = queries.get(query) ?? new Map<string, RetainedItem>();
  retained.delete(id);
  retained.set(id, { item, expiresAt: Date.now() + RETENTION_MS });
  if (retained.size > MAX_RESTORED_ITEMS) {
    const oldest = retained.keys().next().value;
    if (oldest !== undefined) retained.delete(oldest);
  }
  queries.set(query, retained);
}
