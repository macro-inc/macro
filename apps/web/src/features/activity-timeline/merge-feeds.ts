import type { TimelineFeed, TimelineItem } from './timeline-types';

/**
 * Merge several paginated feeds into one newest-first timeline.
 *
 * Correctness rule: an item may only be emitted once no unloaded page of any
 * feed could still contain a newer item. Each feed reports a `boundaryTs` —
 * the timestamp its pagination cursor has reached — so everything at or
 * above the *watermark* (the newest boundary across feeds that still have
 * more pages) is final. Items below it are withheld until the lagging feeds
 * catch up; synthesized items older than their source row simply surface
 * once the watermark descends past them. A feed with more pages but nothing
 * fetched yet pins the watermark at +infinity (nothing renders until its
 * first page lands).
 *
 * `fetchMore` advances the feeds that bound the watermark, so each call
 * makes progress instead of over-fetching sources that are already ahead.
 * Items are deduped by id (first occurrence wins) — sources may overlap,
 * e.g. a websocket insert reapplied to more than one notification query.
 */
export function mergeTimelineFeeds(feeds: TimelineFeed[]): TimelineFeed {
  const feedBoundary = (feed: TimelineFeed): number =>
    feed.boundaryTs() ?? Number.POSITIVE_INFINITY;

  const watermark = (): number => {
    let mark = Number.NEGATIVE_INFINITY;
    for (const feed of feeds) {
      if (!feed.hasMore()) continue;
      mark = Math.max(mark, feedBoundary(feed));
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
      if (feedBoundary(feed) >= mark) feed.fetchMore();
    }
  };

  return {
    items,
    // The merged completeness boundary is the watermark itself: -Infinity
    // when every feed is exhausted (fully complete), +Infinity while a feed
    // with pages has fetched nothing.
    boundaryTs: () => watermark(),
    hasMore: () => feeds.some((feed) => feed.hasMore()),
    isLoading: () => feeds.some((feed) => feed.isLoading()),
    isFetchingMore: () => feeds.some((feed) => feed.isFetchingMore()),
    fetchMore,
  };
}
