import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { refreshSoupEntities } from '@queries/soup/refresh';

const changedSessions = new Set<string>();
let refreshAll = false;
let pending: Promise<void> | undefined;

async function refreshQueuedLists(resolve: () => void): Promise<void> {
  let retryAvailable = true;
  try {
    while (refreshAll || changedSessions.size) {
      const all = refreshAll;
      const sessions = [...changedSessions];
      refreshAll = false;
      changedSessions.clear();
      try {
        // Wait for both transports before retrying so an older pass cannot
        // finish after its replacement and restore a stale snapshot.
        const results = await Promise.allSettled([
          refreshSoupEntities(all ? undefined : sessions, {
            throwOnError: true,
          }),
          refreshActiveGraphqlSoupQueries({ throwOnError: true }),
        ]);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      } catch (error) {
        refreshAll ||= all;
        for (const session of sessions) changedSessions.add(session);
        if (!retryAvailable) throw error;
        retryAvailable = false;
      }
    }
  } catch (error) {
    // Gateway event handlers are fire-and-forget. Report exhaustion without
    // rejecting their unobserved promises; the queued batch remains intact.
    console.error('[agent-session] failed to refresh session lists', error);
  } finally {
    pending = undefined;
    resolve();
  }
}

/**
 * Refresh persisted row metadata after a session update or gateway reconnect.
 * A burst shares one pass; updates committed during a fetch get a later pass.
 * A failed pass retries once with queued updates. Further failures retain the
 * batch for the next event or reconnect instead of dropping it or spinning.
 */
export function refreshAgentSessionLists(sessionId?: string): Promise<void> {
  if (sessionId) changedSessions.add(sessionId);
  else refreshAll = true;

  if (!pending) {
    pending = new Promise<void>((resolve) => {
      queueMicrotask(() => void refreshQueuedLists(resolve));
    });
  }
  return pending;
}
