import type { CacheHost } from './host/types';
import { rotateCacheScope } from './scope';
import { beginCacheWriteSession, endCacheWriteSession } from './session-writes';

const hosts = new Set<CacheHost>();
const sessionRecords = new Map<CacheHost, Set<string>>();

/** Remember identity-less REST records before their durable write is admitted. */
export function recordSessionCacheWrite(host: CacheHost, key: string) {
  let records = sessionRecords.get(host);
  if (!records) {
    records = new Set();
    sessionRecords.set(host, records);
  }
  records.add(key);
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

// Snapshot before a drain: session teardown may unregister the old host.
function prepareCacheClear() {
  const storageHosts = [...hosts].filter((host) => !host.disabled);
  return async () => {
    clearExternalCacheState();
    // With no storage-backed host, a new scope prevents replaying persisted
    // records or queued mutations that this session could not wipe.
    if (storageHosts.length === 0) {
      const rotated = await rotateCacheScope();
      if (rotated) sessionRecords.clear();
      return;
    }
    const results = await Promise.allSettled(
      storageHosts.map(async (host) => {
        if (host.disabled)
          throw new Error('Cache host retired before clearing');
        await host.clear();
        if (host.disabled)
          throw new Error('Cache host retired during clearing');
        sessionRecords.delete(host);
      })
    );
    if (results.some((result) => result.status === 'rejected')) {
      const rotated = await rotateCacheScope();
      if (rotated) sessionRecords.clear();
    }
  };
}

/** Close writes through every logout wipe and teardown, preserving the host. */
export function clearRegisteredCaches(
  clearSession: (clearCaches: () => Promise<void>) => Promise<void> = (clear) =>
    clear()
): Promise<void> {
  const clear = prepareCacheClear();
  return endCacheWriteSession(() => clearSession(clear));
}

/** Remove only REST-written records; reauthentication must retain queued edits. */
export function replaceCacheWriteSession() {
  return beginCacheWriteSession(async () => {
    for (const [host, records] of sessionRecords) {
      // A retired wrapper only acknowledges no-op writes. Never call that a
      // successful repair or discard unrelated queued edits by rotating scope.
      if (host.disabled) throw new Error('Contact cache repair unavailable');
      await host.deleteRecords([...records]);
      if (host.disabled) throw new Error('Contact cache repair unavailable');
      sessionRecords.delete(host);
    }
  });
}
