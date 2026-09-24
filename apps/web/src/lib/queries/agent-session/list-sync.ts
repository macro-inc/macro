import { refreshSoupEntities } from '@queries/soup/refresh';

const changedSessions = new Set<string>();
let pending: Promise<void> | undefined;

async function refreshQueuedLists(resolve: () => void): Promise<void> {
  let retryAvailable = true;
  try {
    while (changedSessions.size) {
      const sessions = [...changedSessions];
      changedSessions.clear();
      try {
        await refreshSoupEntities(sessions, { throwOnError: true });
      } catch (error) {
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
 * Refresh the REST lists that show a session after its metadata changes.
 * A burst shares one pass; updates committed during a fetch get a later pass.
 * A failed pass retries once with queued updates. Further failures retain the
 * batch for the next event instead of dropping it or spinning.
 */
export function refreshAgentSessionLists(sessionId: string): Promise<void> {
  changedSessions.add(sessionId);

  if (!pending) {
    pending = new Promise<void>((resolve) => {
      queueMicrotask(() => void refreshQueuedLists(resolve));
    });
  }
  return pending;
}
