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
  // With no storage-backed host this session (cache disabled or unsupported,
  // startup failed, or not yet started), nothing can wipe the persisted
  // database or its mutation queue. A new scope makes the next open replace
  // it instead of replaying the previous account's queued writes.
  const storageHosts = [...hosts].filter((host) => !host.disabled);
  if (storageHosts.length === 0) {
    await rotateCacheScope();
    return;
  }
  const results = await Promise.allSettled(
    storageHosts.map((host) => host.clear())
  );
  if (results.some((result) => result.status === 'rejected')) {
    await rotateCacheScope();
  }
}
