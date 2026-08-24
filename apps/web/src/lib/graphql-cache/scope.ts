/**
 * Cache scope: an anonymous, client-generated token naming the local Turso
 * cache in OPFS. Deliberately NOT derived from user identity:
 *
 * - construction is synchronous and works offline (no identity waterfall);
 * - no PII leaks into enumerable storage metadata (OPFS filenames);
 * - user↔cache consistency is enforced *inside* the cache by the identity
 *   witness (`QueryRoot.user.id` observed on every write): a response for a
 *   different user than the one bound to the cache wipes and rebinds it
 *   (silent restart). See the design doc and cache-core `identity_witness`.
 *
 * The scope is stable for the browser profile and maps to one Turso/OPFS
 * database identity. Identity changes reset that database's contents. Scope
 * replacement is serialized across tabs so a stale transport failure cannot
 * overwrite a newer logout rotation.
 */

const SCOPE_STORAGE_KEY = 'graphql-cache:scope';
const SCOPE_STORAGE_LOCK = 'graphql-cache:scope-storage';
const quarantineScopeFor = (scope: string): string => `quarantine:${scope}`;

type ScopeStorageAction = () => string | undefined;

/** Serializes scope compare/set whenever Web Locks are supported. */
async function withScopeStorageLock(
  action: ScopeStorageAction
): Promise<string | undefined> {
  let locks: LockManager | undefined;
  try {
    locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  } catch {
    return undefined;
  }
  if (!locks || typeof locks.request !== 'function') {
    try {
      return action();
    } catch {
      return undefined;
    }
  }
  try {
    return await locks.request(SCOPE_STORAGE_LOCK, { mode: 'exclusive' }, () =>
      action()
    );
  } catch {
    // Never perform an unserialized fallback on a platform advertising locks.
    return undefined;
  }
}

/**
 * Conditionally quarantines one uncertain transport scope.
 *
 * Simultaneous failures for the same scope converge on one deterministic
 * replacement. The compare and set run under the same cross-tab lock as
 * logout rotation, so a stale host cannot overwrite a newer unrelated scope.
 */
export async function quarantineCacheScope(
  expectedScope: string
): Promise<string | undefined> {
  const replacement = quarantineScopeFor(expectedScope);
  return await withScopeStorageLock(() => {
    try {
      const current = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (current === expectedScope) {
        localStorage.setItem(SCOPE_STORAGE_KEY, replacement);
        return replacement;
      }
      return current === replacement ? replacement : undefined;
    } catch {
      // Without a trustworthy compare, retaining the persisted value is safer.
      return undefined;
    }
  });
}

/** Quarantines a cache whose durable logout wipe could not be confirmed. */
export async function rotateCacheScope(): Promise<string | undefined> {
  return await withScopeStorageLock(() => {
    try {
      const scope = crypto.randomUUID();
      localStorage.setItem(SCOPE_STORAGE_KEY, scope);
      return scope;
    } catch {
      try {
        localStorage.removeItem(SCOPE_STORAGE_KEY);
      } catch {
        // Inaccessible storage already makes the current scope session-only.
      }
      return undefined;
    }
  });
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
