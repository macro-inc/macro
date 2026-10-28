import { differenceInCalendarDays } from 'date-fns';
import type { BoardItem } from './item';

/** The stretch of time a heading in a list covers. */
export type FeedDay = 'today' | 'yesterday' | 'week' | 'older';

export type FeedDayRow = { kind: 'day'; key: string; day: FeedDay };

export type FeedItemRow = {
  kind: 'item';
  key: string;
  item: BoardItem;
  /** Position among items only, which is what keyboard focus counts. */
  index: number;
};

export type FeedRow = FeedDayRow | FeedItemRow;

/** Which heading activity at `at` falls under, seen from `now`. */
export function feedDay(at: number, now: number): FeedDay {
  const days = differenceInCalendarDays(now, at);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'older';
}

/**
 * Every item, newest activity first, with a heading wherever the day
 * changes. Items of equal age keep the source's order, and an item listed
 * twice (pages can overlap while activity moves) appears once, at its
 * newest.
 */
export function feedRows(items: readonly BoardItem[], now: number): FeedRow[] {
  const seen = new Set<string>();
  const newestFirst = items
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        b.item.lastActivityAt - a.item.lastActivityAt || a.order - b.order
    )
    .map(({ item }) => item)
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  const rows: FeedRow[] = [];
  let day: FeedDay | undefined;
  newestFirst.forEach((item, index) => {
    const itemDay = feedDay(item.lastActivityAt, now);
    if (itemDay !== day) {
      rows.push({ kind: 'day', key: `day:${itemDay}`, day: itemDay });
      day = itemDay;
    }
    rows.push({ kind: 'item', key: item.key, item, index });
  });
  return rows;
}
