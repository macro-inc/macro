import type { CacheHost } from './host/types';
import { rotateCacheScope } from './scope';

const hosts = new Set<CacheHost>();

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
    [...hosts].map((host) => host.clear())
  );
  if (results.some((result) => result.status === 'rejected')) {
    await rotateCacheScope();
  }
}
