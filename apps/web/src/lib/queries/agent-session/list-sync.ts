import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { refreshSoupEntities } from '@queries/soup/refresh';

const changedSessions = new Set<string>();
let refreshAll = false;
let pending: Promise<void> | undefined;

async function refreshQueuedLists(
  resolve: () => void,
  reject: (error: unknown) => void
): Promise<void> {
  try {
    while (refreshAll || changedSessions.size) {
      const all = refreshAll;
      const sessions = [...changedSessions];
      refreshAll = false;
      changedSessions.clear();
      await Promise.all([
        refreshSoupEntities(all ? undefined : sessions),
        refreshActiveGraphqlSoupQueries(),
      ]);
    }
    resolve();
  } catch (error) {
    reject(error);
  } finally {
    pending = undefined;
  }
}

/**
 * Refresh persisted row metadata after a session update or gateway reconnect.
 * A burst shares one pass; updates committed during a fetch get a later pass.
 */
export function refreshAgentSessionLists(sessionId?: string): Promise<void> {
  if (sessionId) changedSessions.add(sessionId);
  else refreshAll = true;

  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => void refreshQueuedLists(resolve, reject));
    });
  }
  return pending;
}
