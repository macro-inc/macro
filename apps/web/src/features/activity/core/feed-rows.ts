import { entryKey, type FeedEntry } from './collapse-runs';
import type { FeedGroup } from './group-events';

/**
 * One virtualized row of the Activity screen. The overview card is row zero
 * so it scrolls with the feed and the virtualizer needs no start margin.
 */
export type FeedRow =
  | { kind: 'overview' }
  | { kind: 'day'; key: string; label: string }
  | { kind: 'entry'; entry: FeedEntry }
  | { kind: 'status'; status: 'loading' | 'error' | 'empty' }
  | { kind: 'tail' };

/** Day headers and their entries in order, plus a tail row while more pages exist. */
export function flattenFeed(
  groups: FeedGroup[],
  options: { hasMore: boolean }
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const group of groups) {
    rows.push({ kind: 'day', key: group.key, label: group.label });
    for (const entry of group.entries) rows.push({ kind: 'entry', entry });
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

/**
 * Carry previous row objects forward where the key matches, so the list
 * keys rows by reference and a refetch or a paging flag flip does not
 * remount every mounted row. Events are immutable once recorded, so a
 * matching id is a matching row; a run is keyed by its first and last event,
 * so a run that grows with the next page reads as a new row.
 */
export function reuseRows(previous: FeedRow[], next: FeedRow[]): FeedRow[] {
  if (previous.length === 0) return next;
  const byKey = new Map(previous.map((row) => [rowKey(row), row]));
  return next.map((row) => byKey.get(rowKey(row)) ?? row);
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
