import {
  buildGroupedSoupRows,
  type DateBucket,
  dateBucket,
  groupSoupEntities,
  type SoupGroup,
} from '@app/features/soup/collection';
import type { DateValue } from '@core/util/date';
import type { EntityData, WithNotification } from '@entity';
import { differenceInCalendarDays, format, isSameYear } from 'date-fns';

/** A row held in place keeps the timestamp it was bucketed by. */
type HeldSortTimestamp = (entityId: string) => DateValue | undefined;

// Threads are listed by latest activity: `sortTs` is the server's stamp for
// that order, and rows that arrived outside the page (websocket inserts,
// search hits) fall back to the thread's own recency.
const emailSortTimestamp = (entity: EntityData, held?: HeldSortTimestamp) =>
  held?.(entity.id) ?? entity.sortTs ?? entity.updatedAt ?? entity.createdAt;

export function groupEmailEntitiesByDate(
  entities: WithNotification<EntityData>[],
  now = new Date(),
  held?: HeldSortTimestamp
): SoupGroup<WithNotification<EntityData>>[] {
  return groupSoupEntities(entities, {
    getGroupId: (entity) =>
      dateBucket(emailSortTimestamp(entity, held), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      dateBucket(emailSortTimestamp(firstEntity, held), now).label,
  });
}

/** Keep today's messages flush with the header; retain older date headings. */
export function buildEmailDateRows(
  entities: WithNotification<EntityData>[],
  now = new Date(),
  held?: HeldSortTimestamp
) {
  const rows = buildGroupedSoupRows(
    groupEmailEntitiesByDate(entities, now, held),
    {
      keyByEntity: true,
    }
  );
  if (rows[0]?.kind === 'group-header' && rows[0].groupId === 'today')
    rows.shift();
  return rows;
}

/**
 * Focus's day headers: Today, Yesterday, the weekday for the rest of the last
 * week, then the date. A pinned Focus header names the one day under it, where
 * the shared `dateBucket` sections that Signal uses span weeks. English, like
 * the rows' own dates: this list is not translated yet.
 */
export function focusDateBucket(
  value: DateValue | null | undefined,
  now = new Date()
): DateBucket {
  const date = new Date(value ?? Number.NaN);
  if (Number.isNaN(date.getTime())) return { key: 'older', label: 'Older' };

  const daysAgo = differenceInCalendarDays(now, date);
  // A future time (clock skew) reads as today, at the top of the list.
  if (daysAgo <= 0) return { key: 'today', label: 'Today' };
  if (daysAgo === 1) return { key: 'yesterday', label: 'Yesterday' };

  const key = format(date, 'yyyy-MM-dd');
  if (daysAgo < 7) return { key, label: format(date, 'EEEE') };

  const dateFormat = isSameYear(date, now) ? 'MMM d' : 'MMM d, yyyy';
  return { key, label: format(date, dateFormat) };
}

/** Focus's rows under its day headers, Today's included. */
export function buildFocusDateRows(
  entities: WithNotification<EntityData>[],
  now = new Date()
) {
  const groups = groupSoupEntities(entities, {
    getGroupId: (entity) =>
      focusDateBucket(emailSortTimestamp(entity), now).key,
    getGroupLabel: (_groupId, firstEntity) =>
      focusDateBucket(emailSortTimestamp(firstEntity), now).label,
  });
  return buildGroupedSoupRows(groups, { keyByEntity: true });
}
