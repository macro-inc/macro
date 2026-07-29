import type { CacheHost } from './host/types';
import { rotateCacheScope } from './scope';

const hosts = new Set<CacheHost>();

/** Registers a cache host for account-lifecycle clearing. */
export function registerCacheHost(host: CacheHost): () => void {
  hosts.add(host);
  return () => hosts.delete(host);
}

/** Best-effort wipe of records and queued user intent during logout. */
export async function clearRegisteredCaches(): Promise<void> {
  const results = await Promise.allSettled(
    [...hosts].map((host) => host.clear())
  );
  if (results.some((result) => result.status === 'rejected')) {
    rotateCacheScope();
  }
}
