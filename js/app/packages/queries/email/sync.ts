import { toast } from '@core/component/Toast/Toast';
import { ENABLE_INBOX_SYNC_STATUS } from '@core/constant/featureFlags';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import {
  BackfillStatus,
  type RefreshEmailEvent,
  RefreshEmailEventOneOfOneoneEvent,
} from '@service-email/generated/schemas';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import { invalidateEmailLinks } from './link';

const BACKFILL_SOUP_REFRESH_INTERVAL = 5_000;

const throttledBackfillSoupRefresh = leadingAndTrailing(
  throttle,
  invalidateAllSoup,
  BACKFILL_SOUP_REFRESH_INTERVAL
);

// The gateway double-encodes the payload, so callers must JSON-parse `data.data`
// (via `withParsedWebsocketPayload`) before passing it here.
function asRefreshEmailEvent(payload: unknown): RefreshEmailEvent | undefined {
  return typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { event?: unknown }).event === 'string'
    ? (payload as RefreshEmailEvent)
    : undefined;
}

/**
 * Handles `refresh_email` websocket events. Steady-state mutations
 * (`upsert_message`, `update_labels`, `delete_message`) already invalidate soup
 * through the notification-driven path, and reacting to them again would
 * double-refetch, so only `backfill`, `link_removed`, and `photo_synced` act
 * here.
 *
 * Backfill produces no notifications, so this is its only refresh signal.
 * `progress` refetches soup, throttled because the backend emits one event per
 * batch of threads. `complete`/`failed` additionally refetch the links list so
 * the inbox's `sync_status` settles out of `SYNCING`, and surface a toast.
 * `photo_synced` refetches the links list so the inbox's derived `photo_url`
 * lands once its self-contact photo finishes uploading.
 */
export function handleRefreshEmail(payload: unknown): void {
  const event = asRefreshEmailEvent(payload);
  if (!event) return;

  // An inbox finished its async teardown — drop its now-deleted threads and
  // settle its links row. This is the only reliable signal that teardown is
  // done; refetching on the delete request itself races the cascade delete.
  if (event.event === 'link_removed') {
    invalidateAllSoup();
    invalidateEmailLinks();
    return;
  }

  // The inbox's own photo finished uploading; refetch links to pick up the
  // newly-derived `photo_url`.
  if (event.event === RefreshEmailEventOneOfOneoneEvent.photo_synced) {
    invalidateEmailLinks();
    return;
  }

  if (event.event !== 'backfill') return;
  const { status } = event;

  if (status === BackfillStatus.failed) {
    invalidateEmailLinks();
    if (ENABLE_INBOX_SYNC_STATUS) {
      toast.failure('Inbox sync failed');
    }
    return;
  }

  throttledBackfillSoupRefresh();

  if (status === BackfillStatus.complete) {
    invalidateEmailLinks();
    if (ENABLE_INBOX_SYNC_STATUS) {
      toast.success('Inbox synced');
    }
  }
}
