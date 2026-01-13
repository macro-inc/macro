import { updateUserAuth } from '@core/auth';
import { queryClient } from '@queries/client';
import { ws } from '@service-connection/websocket';

/**
 * Refreshes app state when resuming from an extended background period.
 *
 * Falls back to full page reload if any step fails.
 */
export async function refreshAppStateOnResume(): Promise<void> {
  try {
    // 1. Reconnect websocket
    ws.reconnect();

    // 2. Invalidate all TanStack Query caches (forces refetch on next access)
    await queryClient.invalidateQueries();

    // 3. Refresh auth state
    await updateUserAuth();
  } catch (_error) {
    // Fallback to full reload if refresh fails
    window.location.reload();
  }
}
