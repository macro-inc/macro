import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';
import {
  type InboxViewContext,
  inboxTabOrdersByNotification,
} from './inbox-query';

type HomePageSource = {
  entities: EntityData[];
  hasMore: boolean;
  isLoading: boolean;
};

function loadedThrough(
  source: HomePageSource,
  getTimestamp: (entity: EntityData) => DateValue | null | undefined
): number {
  if (source.isLoading) return Infinity;
  if (!source.hasMore) return -Infinity;

  // Use the unfiltered source so a page hidden by Home's facets still advances
  // pagination. Unstamped optimistic inserts do not establish a page boundary.
  let oldest = Infinity;
  for (const entity of source.entities) {
    const timestamp = getTimestamp(entity);
    if (timestamp == null) continue;
    oldest = Math.min(oldest, new Date(timestamp).getTime());
  }
  return oldest;
}

/** Only expose the interval both descending feeds have loaded. Fetch the
 * shallower feed next; the other feed's older rows stay buffered. */
export function getHomePagination(
  notifications: HomePageSource,
  activity: HomePageSource,
  context: Pick<InboxViewContext, 'tab' | 'capabilities'>
) {
  const notificationBoundary = loadedThrough(notifications, (entity) =>
    inboxTabOrdersByNotification(context)
      ? entity.notifiedAt
      : (entity.sortTs ?? entity.updatedAt ?? entity.createdAt)
  );
  const activityBoundary = loadedThrough(
    activity,
    (entity) => entity.touchedAt
  );

  return {
    // Keep boundary ties buffered too: unseen rows may share this timestamp.
    cutoff: Math.max(notificationBoundary, activityBoundary),
    loadNotifications:
      notifications.hasMore &&
      !notifications.isLoading &&
      notificationBoundary >= activityBoundary,
    loadActivity:
      activity.hasMore &&
      !activity.isLoading &&
      activityBoundary >= notificationBoundary,
  };
}
