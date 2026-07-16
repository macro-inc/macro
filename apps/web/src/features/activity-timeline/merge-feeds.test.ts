import { describe, expect, it, vi } from 'vitest';
import { mergeTimelineFeeds } from './merge-feeds';
import type { TimelineFeed, TimelineItem } from './timeline-types';

function item(id: string, ts: number): TimelineItem {
  return { kind: 'notification', id, ts, notification: {} as never };
}

function feed(args: {
  items: TimelineItem[];
  /** Defaults to the oldest item ts (plain row-per-item feed). */
  boundaryTs?: number;
  hasMore?: boolean;
  isLoading?: boolean;
  isFetchingMore?: boolean;
  fetchMore?: () => void;
}): TimelineFeed {
  const defaultBoundary = args.items.length
    ? Math.min(...args.items.map((i) => i.ts))
    : undefined;
  return {
    items: () => args.items,
    boundaryTs: () => args.boundaryTs ?? defaultBoundary,
    hasMore: () => args.hasMore ?? false,
    isLoading: () => args.isLoading ?? false,
    isFetchingMore: () => args.isFetchingMore ?? false,
    fetchMore: args.fetchMore ?? (() => {}),
  };
}

describe('mergeTimelineFeeds', () => {
  it('interleaves fully-loaded feeds newest-first', () => {
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 30), item('b', 10)] }),
      feed({ items: [item('c', 20)] }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(merged.hasMore()).toBe(false);
  });

  it('withholds items below the watermark of an incomplete feed', () => {
    const merged = mergeTimelineFeeds([
      // Loaded down to ts=100 with more pages — anything older than 100 in
      // other feeds may still be preceded by unloaded items from this feed.
      feed({ items: [item('a', 150), item('b', 100)], hasMore: true }),
      feed({ items: [item('c', 120), item('d', 50)] }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(merged.hasMore()).toBe(true);
  });

  it('withholds synthesized items older than their feed boundary', () => {
    const merged = mergeTimelineFeeds([
      // A row fetched at ts=100 synthesized an extra event at ts=10; the
      // boundary (cursor position) is still 100.
      feed({
        items: [item('a', 100), item('a-created', 10)],
        boundaryTs: 100,
        hasMore: true,
      }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a']);
  });

  it('emits synthesized old items once every feed is exhausted', () => {
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 100), item('a-created', 10)], boundaryTs: 100 }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a', 'a-created']);
  });

  it('emits nothing while a feed with pages has loaded no items yet', () => {
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 10)] }),
      feed({ items: [], hasMore: true }),
    ]);
    expect(merged.items()).toEqual([]);
  });

  it('emits everything once an empty feed is exhausted', () => {
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 10)] }),
      feed({ items: [], hasMore: false }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a']);
  });

  it('dedupes items by id, keeping the first occurrence', () => {
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 30)] }),
      feed({ items: [item('a', 30), item('b', 20)] }),
    ]);
    expect(merged.items().map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('fetches more only from the feeds bounding the watermark', () => {
    const fetchA = vi.fn();
    const fetchB = vi.fn();
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 100)], hasMore: true, fetchMore: fetchA }),
      feed({ items: [item('b', 50)], hasMore: true, fetchMore: fetchB }),
    ]);
    merged.fetchMore();
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).not.toHaveBeenCalled();
  });

  it('skips feeds that are already fetching', () => {
    const fetchA = vi.fn();
    const merged = mergeTimelineFeeds([
      feed({
        items: [item('a', 100)],
        hasMore: true,
        isFetchingMore: true,
        fetchMore: fetchA,
      }),
    ]);
    merged.fetchMore();
    expect(fetchA).not.toHaveBeenCalled();
  });

  it('does nothing when every feed is exhausted', () => {
    const fetchA = vi.fn();
    const merged = mergeTimelineFeeds([
      feed({ items: [item('a', 10)], fetchMore: fetchA }),
    ]);
    merged.fetchMore();
    expect(fetchA).not.toHaveBeenCalled();
  });
});
