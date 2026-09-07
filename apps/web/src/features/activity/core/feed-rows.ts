import { entryKey, type FeedEntry } from './collapse-runs';
import type { FeedGroup } from './group-events';

/** Which connector segments a glyph-rail row draws toward its neighbours. */
export type RailEnds = { above: boolean; below: boolean };

/**
 * One virtualized row of the Activity screen. The overview card is row zero
 * so it scrolls with the feed and the virtualizer needs no start margin.
 */
export type FeedRow =
  | { kind: 'overview' }
  | { kind: 'day'; key: string; label: string }
  | { kind: 'entry'; entry: FeedEntry; rail: RailEnds }
  | { kind: 'status'; status: 'loading' | 'error' | 'empty' }
  | { kind: 'tail' };

/**
 * Day headers and their entries in order, plus a tail row while more pages
 * exist. The rail joins entries within a day and never crosses a header.
 */
export function flattenFeed(
  groups: FeedGroup[],
  options: { hasMore: boolean }
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const group of groups) {
    rows.push({ kind: 'day', key: group.key, label: group.label });
    const last = group.entries.length - 1;
    for (const [index, entry] of group.entries.entries()) {
      rows.push({
        kind: 'entry',
        entry,
        rail: { above: index > 0, below: index < last },
      });
    }
  }
  if (options.hasMore) rows.push({ kind: 'tail' });
  return rows;
}

function rowKey(row: FeedRow): string {
  switch (row.kind) {
    case 'overview':
    case 'tail':
      return row.kind;
    case 'day':
      return `day:${row.key}`;
    case 'entry':
      return `entry:${entryKey(row.entry)}`;
    case 'status':
      return `status:${row.status}`;
  }
}

function sameRail(previous: FeedRow, next: FeedRow): boolean {
  if (previous.kind !== 'entry' || next.kind !== 'entry') return true;
  return (
    previous.rail.above === next.rail.above &&
    previous.rail.below === next.rail.below
  );
}

/**
 * Carry previous row objects forward where the key matches, so the list
 * keys rows by reference and a refetch or a paging flag flip does not
 * remount every mounted row. Events are immutable once recorded, so a
 * matching id is a matching row; a run is keyed by its first and last event,
 * so a run that grows with the next page reads as a new row. The last entry
 * of a day gains a rail below when the next page adds to that day, so a
 * changed rail also reads as a new row.
 */
export function reuseRows(previous: FeedRow[], next: FeedRow[]): FeedRow[] {
  if (previous.length === 0) return next;
  const byKey = new Map(previous.map((row) => [rowKey(row), row]));
  return next.map((row) => {
    const reused = byKey.get(rowKey(row));
    return reused && sameRail(reused, row) ? reused : row;
  });
}

/** Floor for the near-bottom threshold so tiny viewports still page. */
const MIN_FETCH_THRESHOLD = 100;

/**
 * Whether the scroller is within one viewport of its end, the point at which
 * the next page should start loading so it usually lands before the user
 * reaches the bottom.
 */
export function shouldFetchMore(metrics: {
  scrollSize: number;
  viewportSize: number;
  offset: number;
}): boolean {
  const threshold = Math.max(MIN_FETCH_THRESHOLD, metrics.viewportSize);
  return (
    metrics.scrollSize - metrics.viewportSize - metrics.offset <= threshold
  );
}
