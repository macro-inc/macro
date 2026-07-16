import type { TimelineFeed, TimelineItem } from './timeline-types';

/**
 * Merge several newest-first feeds into one newest-first timeline.
 *
 * Correctness rule: an item may only be emitted once no unloaded page of any
 * feed could still contain a newer item. Each feed is sorted descending, so
 * everything at or above the *watermark* — the newest "oldest loaded item"
 * across feeds that still have more pages — is final. Items below it are
 * withheld until the lagging feeds catch up. A feed with more pages but
 * nothing loaded yet pins the watermark at +infinity (nothing renders until
 * its first page lands).
 *
 * `fetchMore` advances the feeds that bound the watermark, so each call
 * makes progress instead of over-fetching sources that are already ahead.
 * Items are deduped by id (first, i.e. newest, occurrence wins) — sources
 * may overlap, e.g. a websocket insert reapplied to more than one
 * notification query.
 */
export function mergeTimelineFeeds(feeds: TimelineFeed[]): TimelineFeed {
  const oldestLoadedTs = (feed: TimelineFeed): number => {
    const items = feed.items();
    const last = items[items.length - 1];
    return last ? last.ts : Number.POSITIVE_INFINITY;
  };

  const watermark = (): number => {
    let mark = Number.NEGATIVE_INFINITY;
    for (const feed of feeds) {
      if (!feed.hasMore()) continue;
      mark = Math.max(mark, oldestLoadedTs(feed));
    }
    return mark;
  };

  const items = (): TimelineItem[] => {
    const mark = watermark();
    const merged: TimelineItem[] = [];
    const seen = new Set<string>();

    for (const feed of feeds) {
      for (const item of feed.items()) {
        if (item.ts < mark) continue;
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }

    merged.sort((a, b) =>
      a.ts === b.ts ? (a.id < b.id ? 1 : -1) : b.ts - a.ts
    );
    return merged;
  };

  const fetchMore = () => {
    const mark = watermark();
    if (mark === Number.NEGATIVE_INFINITY) return;
    for (const feed of feeds) {
      if (!feed.hasMore()) continue;
      if (feed.isFetchingMore() || feed.isLoading()) continue;
      if (oldestLoadedTs(feed) >= mark) feed.fetchMore();
    }
  };

  return {
    items,
    hasMore: () => feeds.some((feed) => feed.hasMore()),
    isLoading: () => feeds.some((feed) => feed.isLoading()),
    isFetchingMore: () => feeds.some((feed) => feed.isFetchingMore()),
    fetchMore,
  };
}
