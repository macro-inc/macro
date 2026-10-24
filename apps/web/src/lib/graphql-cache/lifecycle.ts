import type { CacheHost } from './host/types';
import { rotateCacheScope } from './scope';

const hosts = new Set<CacheHost>();

// `clear` is an unbounded ordering barrier behind every queued engine request,
// so a wedged worker would otherwise hold logout open before the server
// session is ended.
export const CACHE_CLEAR_TIMEOUT_MS = 5_000;

async function clearWithinTimeout(host: CacheHost): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('cache clear timed out')),
      CACHE_CLEAR_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([host.clear(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function clearExternalCacheState(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('graphql-soup-backfill:')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

/** Registers a cache host for account-lifecycle clearing. */
export function registerCacheHost(host: CacheHost): () => void {
  hosts.add(host);
  return () => hosts.delete(host);
}

/** Best-effort reset of each active cache database during logout. */
export async function clearRegisteredCaches(): Promise<void> {
  // Soup cursors live outside the normalized cache. Reset them in the same
  // lifecycle operation so no later login resumes past records wiped below.
  clearExternalCacheState();
  const results = await Promise.allSettled(
    [...hosts].map((host) => clearWithinTimeout(host))
  );
  // A timed-out wipe is unconfirmed, so it quarantines the scope like a failure.
  if (results.some((result) => result.status === 'rejected')) {
    await rotateCacheScope();
  }
}
