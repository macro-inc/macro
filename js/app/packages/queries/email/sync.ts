import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';

const BACKFILL_SOUP_REFRESH_INTERVAL = 5_000;

const throttledBackfillSoupRefresh = leadingAndTrailing(
  throttle,
  invalidateAllSoup,
  BACKFILL_SOUP_REFRESH_INTERVAL
);

/**
 * Handles `refresh_email` websocket events. Only `backfill` events refetch
 * here: steady-state mutations (`upsert_message`, `update_labels`,
 * `delete_message`) already invalidate soup through the notification-driven
 * path, and reacting to them again would double-refetch. Backfill produces no
 * notifications, so this is its only refresh signal — throttled because the
 * backend emits one event per batch of backfilled threads.
 */
export function handleRefreshEmail(eventType: unknown): void {
  if (eventType !== 'backfill') return;
  throttledBackfillSoupRefresh();
}
