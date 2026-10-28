import type { SoupAstItemsData } from '../items';
import type { GroupMeta } from './types';

const buckets = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This Week'],
  ['last_week', 'Last Week'],
  ['this_month', 'This Month'],
  ['last_month', 'Last Month'],
  ['older', 'Older'],
] as const;

/** Matches models_grouping's UTC date buckets; counts describe loaded cached mail. */
export function groupCachedMailByDate(
  data: SoupAstItemsData,
  now = new Date()
): SoupAstItemsData {
  const groups = new Map<number, GroupMeta>();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  for (const item of Object.values(data.itemsById ?? {})) {
    if (item.tag !== 'emailThread') continue;
    const timestamp = new Date(item.data.sortTs);
    const day = Date.UTC(
      timestamp.getUTCFullYear(),
      timestamp.getUTCMonth(),
      timestamp.getUTCDate()
    );
    const age = Math.floor((today - day) / 86_400_000);
    // A future-dated item (clock skew) is "older", as in compute_date_bucket.
    const index =
      age < 0
        ? 6
        : age === 0
          ? 0
          : age === 1
            ? 1
            : age <= 6
              ? 2
              : age <= 13
                ? 3
                : age <= 30
                  ? 4
                  : age <= 60
                    ? 5
                    : 6;
    const group = groups.get(index) ?? {
      key: buckets[index][0],
      label: buckets[index][1],
      displayOrder: index,
      totalCount: 0,
      itemIds: [],
      nextCursor: null,
    };
    group.itemIds.push(item.data.id);
    group.totalCount += 1;
    groups.set(index, group);
  }
  return {
    ...data,
    groups: [...groups]
      .sort(([left], [right]) => left - right)
      .map(([, group]) => group),
  };
}
