import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { compareInboxRows } from '../core/inbox-row';

/** One loaded inbox entry: the rows filed under one entity. */
export type NotificationInboxGroup = {
  /** `<entity type>:<entity id>`; live changes replace a group's rows. */
  groupId: string;
  /** The group's newest pending notification, epoch milliseconds. */
  sortAt: number;
  rows: NotificationInboxRow[];
};

/**
 * Each group once. Pages refetched one at a time can catch a group on two of
 * them when it moves between pages in the meantime; its newer copy is the
 * current one.
 */
function newestCopies(
  groups: readonly NotificationInboxGroup[]
): NotificationInboxGroup[] {
  const newest = new Map<string, NotificationInboxGroup>();
  for (const group of groups) {
    const seen = newest.get(group.groupId);
    if (!seen || group.sortAt > seen.sortAt) newest.set(group.groupId, group);
  }
  return [...newest.values()];
}

/**
 * The rows of the loaded groups, newest first. The inbox pages by group, and
 * no row is newer than its group's place, so a row older than the last
 * loaded group could still be outranked by a row on a page not loaded yet:
 * those rows wait for the next page, unless the inbox is exhausted.
 */
export function orderInboxRows(
  groups: readonly NotificationInboxGroup[],
  exhausted: boolean
): NotificationInboxRow[] {
  const boundary = exhausted
    ? Number.NEGATIVE_INFINITY
    : (groups.at(-1)?.sortAt ?? Number.POSITIVE_INFINITY);
  return newestCopies(groups)
    .flatMap((group) => group.rows)
    .filter((row) => row.latestAt >= boundary)
    .sort(compareInboxRows);
}
