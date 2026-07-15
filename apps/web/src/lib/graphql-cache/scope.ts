/**
 * Cache scope: an anonymous, client-generated uuid naming the local cache
 * storage (IndexedDB database). Deliberately NOT derived from user identity:
 *
 * - construction is synchronous and works offline (no identity waterfall);
 * - no PII leaks into enumerable storage metadata (database names);
 * - user↔cache consistency is enforced *inside* the cache by the identity
 *   witness (`QueryRoot.user.id` observed on every write): a response for a
 *   different user than the one bound to the cache wipes and rebinds it
 *   (silent restart). See the design doc and cache-core `identity_witness`.
 *
 * The uuid is stable for the browser profile; identity changes normally rotate
 * the cache *contents*. A failed logout wipe rotates the scope as a quarantine.
 */

const SCOPE_STORAGE_KEY = 'graphql-cache:scope';

/** Quarantines a cache whose durable logout wipe could not be confirmed. */
export function rotateCacheScope(): void {
  const scope = crypto.randomUUID();
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, scope);
  } catch {
    try {
      localStorage.removeItem(SCOPE_STORAGE_KEY);
    } catch {
      // Inaccessible storage already makes the current scope session-only.
    }
  }
}

export function getOrCreateCacheScope(): string {
  let scope: string | null = null;
  try {
    scope = localStorage.getItem(SCOPE_STORAGE_KEY);
  } catch {
    // Storage access denied (privacy mode edge cases): session-only scope.
  }
  if (!scope) {
    scope = crypto.randomUUID();
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, scope);
    } catch {
      // Non-persistent scope is fine; the cache is disposable.
    }
  }
  return scope;
}
