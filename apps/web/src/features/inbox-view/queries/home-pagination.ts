type HomePageSource = {
  oldestFetchedTimestamp?: number;
  hasMore: boolean;
  isLoading: boolean;
};

function loadedThrough(source: HomePageSource): number {
  if (source.isLoading) return Infinity;
  if (!source.hasMore) return -Infinity;

  return source.oldestFetchedTimestamp ?? Infinity;
}

/** Only expose the interval both descending feeds have loaded. Fetch the
 * shallower feed next; the other feed's older rows stay buffered. */
export function getHomePagination(
  notifications: HomePageSource,
  activity: HomePageSource
) {
  const notificationBoundary = loadedThrough(notifications);
  const activityBoundary = loadedThrough(activity);

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
