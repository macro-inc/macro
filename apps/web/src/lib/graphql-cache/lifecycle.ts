import { retainCacheHost } from './host/retirable-host';
import type { CacheHost } from './host/types';
import { rotateCacheScope } from './scope';
import { beginCacheWriteSession, endCacheWriteSession } from './session-writes';

const hosts = new Set<CacheHost>();
// Factories capture the original backend/scope and only accept typed safe-to-
// reopen failures. A different current host is never a repair substitute.
type RecoverCacheHost = (error: unknown) => CacheHost | undefined;
const recoveryByHost = new WeakMap<CacheHost, RecoverCacheHost>();
const sessionRecords = new Map<
  CacheHost,
  {
    keys: Set<string>;
    retained: ReturnType<typeof retainCacheHost>;
    recover: RecoverCacheHost | undefined;
  }
>();

/** Remember identity-less REST records before their durable write is admitted. */
export function recordSessionCacheWrite(host: CacheHost, key: string) {
  let records = sessionRecords.get(host);
  if (!records) {
    // Hold the exact physical owner before dispatch. A later public retirement
    // must neither abort this write nor strand its narrow cleanup obligation.
    records = {
      keys: new Set(),
      retained: retainCacheHost(host),
      recover: recoveryByHost.get(host),
    };
    sessionRecords.set(host, records);
  }
  records.keys.add(key);
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
export function registerCacheHost(
  host: CacheHost,
  recover?: RecoverCacheHost
): () => void {
  hosts.add(host);
  if (recover) recoveryByHost.set(host, recover);
  return () => hosts.delete(host);
}

function forgetSessionRecords(owner: CacheHost) {
  sessionRecords.get(owner)?.retained?.release();
  sessionRecords.delete(owner);
}

function forgetAllSessionRecords() {
  for (const owner of sessionRecords.keys()) forgetSessionRecords(owner);
}

// Snapshot before a drain: session teardown may unregister the old host.
function prepareCacheClear() {
  const storageHosts = [
    ...new Set([...hosts, ...sessionRecords.keys()]),
  ].flatMap((owner) => {
    const retained = retainCacheHost(
      sessionRecords.get(owner)?.retained?.host ?? owner
    );
    const recover =
      sessionRecords.get(owner)?.recover ?? recoveryByHost.get(owner);
    return retained ? [{ owner, ...retained, recover }] : [];
  });
  return {
    release: () => {
      for (const retained of storageHosts) retained.release();
    },
    clear: async () => {
      clearExternalCacheState();
      // With no storage-backed host, a new scope prevents replaying persisted
      // records or queued mutations that this session could not wipe.
      if (storageHosts.length === 0) {
        const rotated = await rotateCacheScope();
        if (rotated) forgetAllSessionRecords();
        return;
      }
      const results = await Promise.allSettled(
        storageHosts.map(async ({ owner, host, recover }) => {
          // A preceding login may have recovered storage while this logout was
          // waiting. Pin that owner now; keep the original snapshot pinned too.
          const current = retainCacheHost(
            sessionRecords.get(owner)?.retained?.host ?? host
          );
          try {
            try {
              await (current?.host ?? host).clear();
            } catch (error) {
              const replacement = recover?.(error);
              if (!replacement) throw error;
              const recovered = retainCacheHost(replacement);
              replacement.dispose();
              if (!recovered) throw error;
              try {
                await recovered.host.clear();
              } finally {
                recovered.release();
              }
            }
            forgetSessionRecords(owner);
          } finally {
            current?.release();
          }
        })
      );
      if (results.some((result) => result.status === 'rejected')) {
        const rotated = await rotateCacheScope();
        if (rotated) forgetAllSessionRecords();
      }
    },
  };
}

/** Close writes through every logout wipe and teardown, preserving the host. */
export function clearRegisteredCaches(
  clearSession: (clearCaches: () => Promise<void>) => Promise<void> = (clear) =>
    clear()
): Promise<void> {
  const retained = prepareCacheClear();
  return endCacheWriteSession(async (drained) => {
    let clearing: Promise<void> | undefined;
    const clear = () => (clearing ??= drained.then(retained.clear));
    try {
      await clearSession(clear);
    } finally {
      try {
        await clear();
      } finally {
        retained.release();
      }
    }
  });
}

/** Remove only REST-written records; reauthentication must retain queued edits. */
export function replaceCacheWriteSession() {
  return beginCacheWriteSession(async () => {
    for (const [owner, records] of sessionRecords) {
      let host = records.retained?.host;
      // Only the retained physical owner can prove cleanup. Never substitute
      // another scope or treat a retired wrapper's no-op as a successful delete.
      if (!host || host.disabled)
        throw new Error('Contact cache repair unavailable');
      try {
        await host.deleteRecords([...records.keys]);
      } catch (error) {
        const replacement = records.recover?.(error);
        if (!replacement) throw error;
        const retained = retainCacheHost(replacement);
        replacement.dispose();
        if (!retained) throw error;
        records.retained?.release();
        records.retained = retained;
        host = retained.host;
        // One safe recovery attempt per login; failed cleanup keeps every key
        // and its new physical owner for a later explicit retry.
        await host.deleteRecords([...records.keys]);
      }
      if (host.disabled) throw new Error('Contact cache repair unavailable');
      forgetSessionRecords(owner);
    }
  });
}
