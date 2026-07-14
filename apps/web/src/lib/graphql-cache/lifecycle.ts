import type { CacheHost } from './host/types';

const hosts = new Set<CacheHost>();

/** Registers a cache host for account-lifecycle clearing. */
export function registerCacheHost(host: CacheHost): void {
  hosts.add(host);
}

/** Best-effort wipe of records and queued user intent during logout. */
export async function clearRegisteredCaches(): Promise<void> {
  await Promise.allSettled([...hosts].map((host) => host.clear()));
}
