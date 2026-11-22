import { useFlow } from '@app/observability/flow';
import type { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { queryReadyGate } from '@queries/gate';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createEffect, on } from 'solid-js';

/** What a sidebar list has loaded so far. */
export type ChannelListLoad = {
  enabled: boolean;
  /** Rows the list shows, from the cache or the network. */
  rows: number;
  /** A network read is in flight. */
  fetching: boolean;
  /** The cache or the network has answered, or the load failed. */
  answered: boolean;
  /** Soup pages the list holds; a by-ID lookup counts its batches. */
  pages: number;
  failed: boolean;
};

/** The load state of one Soup list, read without suspending. */
export function soupListLoad(query: SoupAstItemsQuery): ChannelListLoad {
  const failed = Boolean(query.error ?? query.fetchError);

  return {
    enabled: query.isEnabled,
    rows: queryReadyGate(query) ? query.data.entities.length : 0,
    fetching: query.isFetching,
    answered: failed || !query.isPending,
    // The REST fallback reports no GraphQL reads and holds one page here.
    pages: query.revalidationQueries?.length || 1,
    failed,
  };
}

/** The load state of a by-ID channel lookup. */
export function channelLookupLoad(
  lookup: ReturnType<typeof useCachedChannelsByIds>,
  enabled: boolean
): ChannelListLoad {
  return {
    enabled,
    rows: lookup.channels().length,
    fetching: lookup.isFetching(),
    answered: lookup.isSettled(),
    pages: lookup.batchCount(),
    failed: lookup.error() !== undefined,
  };
}

/**
 * Records one sidebar list's load on the routed flow's span, once each time
 * the list is enabled: whether rows came from the cache, and how many rows,
 * pages and network reads the load took. Counts only, no channel identity.
 */
export function traceChannelListLoad(
  name: string,
  load: Accessor<ChannelListLoad>
): void {
  const flow = useFlow();
  let requests = 0;
  let fetching = false;
  let cacheHit = false;
  let recorded = false;

  createEffect(
    on(load, (current) => {
      if (!current.enabled) {
        requests = 0;
        fetching = false;
        cacheHit = false;
        recorded = false;
        return;
      }
      if (recorded) return;

      if (current.fetching && !fetching) requests += 1;
      fetching = current.fetching;

      // Rows on screen before any network read finished came from the cache.
      if (current.rows > 0 && (current.fetching || requests === 0))
        cacheHit = true;

      if (!current.answered || current.fetching || current.pages === 0) return;
      recorded = true;

      const span = flow.span;
      span.setAttr(`channels.sidebar.${name}.cache_hit`, cacheHit);
      span.setAttr(`channels.sidebar.${name}.rows`, current.rows);
      span.setAttr(`channels.sidebar.${name}.pages`, current.pages);
      span.setAttr(`channels.sidebar.${name}.requests`, requests);
      span.setAttr(`channels.sidebar.${name}.failed`, current.failed);
    })
  );
}
