import { toast } from '@core/component/Toast/Toast';
import { ENABLE_INBOX_SYNC_STATUS } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import {
  BackfillStatus,
  type RefreshEmailEvent,
  RefreshEmailEventOneOfOneoneEvent,
  RefreshEmailEventOneOfOnethreeEvent,
} from '@service-email/generated/schemas';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import { clearBackfillProgress, setBackfillProgress } from './backfill';
import { invalidateEmailFolderQueries } from './folder-cache';
import { emailKeys } from './keys';
import { invalidateEmailLinks } from './link';

const BACKFILL_SOUP_REFRESH_INTERVAL = 5_000;

const throttledBackfillSoupRefresh = leadingAndTrailing(
  throttle,
  invalidateAllSoup,
  BACKFILL_SOUP_REFRESH_INTERVAL
);

const throttledFolderRefresh = leadingAndTrailing(
  throttle,
  () => fireAndForget(invalidateEmailFolderQueries(), 'email-folders'),
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
 * Handles global `refresh_email` effects. Mounted mail readers independently
 * refresh their matching links, including when notifications are suppressed.
 * Spam/Trash also use isolated REST previews and need explicit invalidation.
 *
 * Backfill produces no notifications, so these are its only refresh signals.
 * `backfill_progress` carries live progress: it refetches soup (throttled,
 * because the backend emits one event per batch of threads) and on `complete`
 * refetches the links list so the inbox's `sync_status` settles out of
 * `SYNCING`, with a toast. The `backfill` event carries completion without
 * thread counts, or legacy failure. `photo_synced` refetches links so the inbox's derived
 * `photo_url` lands once its self-contact photo finishes uploading.
 * `focus_updated` belongs to the mounted Focus list (see `useEmailFocusQuery`).
 */
export function handleRefreshEmail(payload: unknown): void {
  const event = asRefreshEmailEvent(payload);
  if (!event) return;

  if (
    event.event === 'upsert_message' ||
    event.event === 'update_labels' ||
    event.event === 'delete_message'
  ) {
    throttledFolderRefresh();
    queryClient.invalidateQueries({
      queryKey: emailKeys.composeDraftState._def,
    });
    return;
  }

  // An inbox finished its async teardown — drop its now-deleted threads and
  // settle its links row. This is the only reliable signal that teardown is
  // done; refetching on the delete request itself races the cascade delete.
  if (event.event === 'link_removed') {
    clearBackfillProgress(event.link_id);
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

  // Folder imports have no thread counts, but still send completion. Legacy
  // jobs also use this event for failure; counted jobs use backfill_progress.
  if (event.event === 'backfill') {
    if (event.status === BackfillStatus.complete) {
      clearBackfillProgress(event.link_id);
      invalidateEmailLinks();
      return;
    }
    if (event.status === BackfillStatus.failed) {
      clearBackfillProgress(event.link_id);
      invalidateEmailLinks();
      if (ENABLE_INBOX_SYNC_STATUS) {
        toast.failure('Inbox sync failed');
      }
    }
    return;
  }

  // Live backfill progress. Record `completed_threads`/`total_threads` for the
  // progress UI and keep soup fresh (throttled, one event per batch). On
  // completion, drop the progress entry and settle the links row out of
  // `SYNCING` with a toast.
  if (event.event === RefreshEmailEventOneOfOnethreeEvent.backfill_progress) {
    throttledBackfillSoupRefresh();

    if (event.status === BackfillStatus.complete) {
      clearBackfillProgress(event.link_id);
      invalidateEmailLinks();
      if (ENABLE_INBOX_SYNC_STATUS) {
        toast.success('Inbox synced');
      }
    } else {
      setBackfillProgress(
        event.link_id,
        event.completed_threads,
        event.total_threads
      );
    }
  }
}
