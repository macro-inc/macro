/**
 * Best-effort removal of the normalized cache's former IndexedDB database.
 *
 * Cutover never opens, enumerates, or migrates the old database. A blocked
 * deletion settles immediately for callers while the browser remains free to
 * complete the same request after an old tab releases its connection.
 */

const deletionAttempts = new Map<string, Promise<void>>();

/** Deletes exactly the former `graphql-cache:<scope>` database once per page session. */
export function deleteLegacyNormalizedCacheIdb(scope: string): Promise<void> {
  const existing = deletionAttempts.get(scope);
  if (existing) return existing;

  const attempt = new Promise<void>((resolve) => {
    try {
      const factory = globalThis.indexedDB;
      if (!factory || typeof factory.deleteDatabase !== 'function') {
        resolve();
        return;
      }

      const request = factory.deleteDatabase(`graphql-cache:${scope}`);
      let settled = false;
      const settle = (event: Event): void => {
        // Keep this handler installed after `blocked`: the same request can
        // later fail, and preventing its error avoids an uncaught global event.
        if (event.type === 'error') event.preventDefault();
        if (settled) return;
        settled = true;
        resolve();
      };
      request.onsuccess = settle;
      request.onerror = settle;
      request.onblocked = settle;
    } catch {
      resolve();
    }
  });
  deletionAttempts.set(scope, attempt);
  return attempt;
}
