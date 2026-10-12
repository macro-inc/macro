import { createPreparationExecutor } from './executor';
import { artifactDatabaseMayExist, IndexedDbArtifacts } from './indexeddb';
import { digest } from './keys';
import { EmailRenderCache } from './service';
import { storageDeadline } from './store';

export interface EmailRenderSessionOptions {
  origin: string;
  environment: string;
  profileScope: string;
  viewerId: string;
  enabled: boolean;
  native: boolean;
  mobile: boolean;
  waitForInvalidation(): Promise<unknown>;
  /** Durable, cross-tab sign-in state. A tab that missed a sign-out broadcast
   * still must not persist for an identity the device has signed out of. */
  isSignedIn?(): boolean;
  onRemoteInvalidation(sessionEnded: boolean, clearing: Promise<void>): void;
}

/** `remote`: another tab already cleared storage; `local`: clear without
 * telling other tabs; `shared`: clear and tell them. */
type ClearMode = 'remote' | 'local' | 'shared';

const quarantineKey = (namespace: string) =>
  `email-render-quarantine:${namespace}`;
const channelName = (namespace: string) => `email-render:${namespace}`;

/** Clears hold the namespace exclusively; opening waits out a clear in progress,
 * whose quarantine marker is transient. The lock only orders work: when it is
 * unavailable, fails, or takes over 5s, the work still runs unlocked. */
async function withClearLock<T>(
  namespace: string,
  mode: LockMode,
  work: () => Promise<T>
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return await work();
  let started = false;
  try {
    return await locks.request(
      `email-render-clear:${namespace}`,
      {
        mode,
        signal:
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(5000)
            : undefined,
      },
      async () => {
        started = true;
        return await work();
      }
    );
  } catch (error) {
    if (started) throw error;
    return await work();
  }
}

/** Browser cache lifetime with explicit inputs; no reactive owner or app hooks. */
export function createEmailRenderSession(options: EmailRenderSessionOptions) {
  const namespace = digest(
    JSON.stringify([
      options.origin,
      options.environment,
      options.profileScope,
      options.viewerId,
    ])
  );
  /** Only a definite answer counts: storage that throws is not a sign-out. */
  const signedOut = () => {
    try {
      return options.isSignedIn?.() === false;
    } catch {
      return false;
    }
  };
  let store: IndexedDbArtifacts | undefined;
  let invalidated = false;
  let sentSessionEnd = false;
  let channel: BroadcastChannel | undefined;
  let disposed = false;
  let clearing: Promise<void> | undefined;
  const cache = new EmailRenderCache({
    memoryBytes: (options.mobile ? 8 : 16) * 1024 * 1024,
    // Native stays memory-only until its worker and storage origins are verified.
    executor: createPreparationExecutor(!options.native),
    // Another tab invalidated while this session was connecting or opening
    // storage, so its broadcast was missed. Heal exactly as if it had arrived.
    onStaleGeneration: () => {
      if (!invalidated) reportRemote(false);
    },
    // A sign-out that moved no generation (its clear failed, or the signing-out
    // tab had no session) is still a sign-out: never persist past it.
    mayPersist: () => {
      if (!signedOut()) return true;
      reportRemote(true);
      return false;
    },
    store: options.native
      ? undefined
      : async () => {
          await options.waitForInvalidation();
          const name = await namespace;
          if (disposed || invalidated || signedOut()) return;
          // Read the marker under the clear lock, so a clear in progress is
          // waited out rather than seen half-done. Re-check briefly: another
          // tab's write can reach this one's storage view late. Only a marker
          // that persists is a failed clear, which keeps persistence off.
          for (let attempt = 0; ; attempt++) {
            const quarantined = await withClearLock(
              name,
              'shared',
              async () => localStorage.getItem(quarantineKey(name)) !== null
            );
            if (!quarantined) break;
            if (attempt === 4 || disposed || invalidated) return;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          let budget = (options.mobile ? 32 : 128) * 1024 * 1024;
          const estimate = await storageDeadline(
            navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
            50
          );
          if (estimate?.quota)
            budget = Math.min(
              budget,
              Math.max(0, (estimate.quota - (estimate.usage ?? 0)) / 4)
            );
          if (disposed || invalidated || budget < 1024 * 1024) return;
          store ??= new IndexedDbArtifacts(name, budget);
          return store;
        },
  });
  // Initialize storage ahead of body requests, without fetching or preparing.
  if (options.enabled) cache.initializeStorage();

  async function broadcastInvalidation(sessionEnded: boolean) {
    if (sessionEnded && sentSessionEnd) return;
    if (sessionEnded) sentSessionEnd = true;
    const name = await namespace;
    try {
      const sender = new BroadcastChannel(channelName(name));
      sender.postMessage({ kind: 'invalidate', sessionEnded });
      sender.close();
    } catch {
      /* Storage quarantine still protects subsequent sessions. */
    }
  }

  async function clearStorage(mode: ClearMode, sessionEnded: boolean) {
    if (mode === 'remote') {
      store?.close();
      store = undefined;
      return;
    }
    const name = await namespace;
    if (mode === 'shared') await broadcastInvalidation(sessionEnded);
    // Without IndexedDB nothing can have been stored, so nothing to quarantine.
    if (options.native || typeof indexedDB === 'undefined') return;
    // A session that never opened storage, for a database that was never
    // created, has nothing to clear. This keeps flag-off invalidations from
    // creating storage; a stale quarantine has nothing left to protect.
    if (!store && !(await artifactDatabaseMayExist(name))) {
      try {
        localStorage.removeItem(quarantineKey(name));
      } catch {
        // Unavailable storage holds no quarantine either.
      }
      return;
    }
    await withClearLock(name, 'exclusive', async () => {
      // Failed clears make this namespace ineligible for subsequent sessions.
      try {
        localStorage.setItem(quarantineKey(name), '1');
      } catch {
        // Still clear cold artifacts when the quarantine store is unavailable.
      }
      // Clearing alone must never create the database it means to empty.
      const target = store ?? new IndexedDbArtifacts(name, 0, false);
      try {
        const result = await storageDeadline(
          (async () => {
            await target.invalidate();
            return true;
          })(),
          2000
        );
        if (result) localStorage.removeItem(quarantineKey(name));
      } catch {
        /* Quarantine remains when storage is inaccessible. */
      } finally {
        target.close();
        // A later clear (a late sign-out) must reopen, not reuse a closed store.
        if (target === store) store = undefined;
      }
    });
  }

  async function clear(mode: ClearMode, sessionEnded = false): Promise<void> {
    if (invalidated) {
      // A pending source reset must not swallow a subsequent logout. Clear
      // again too: other tabs may have written since the first clear, and
      // tabs that hear the sign-out leave storage to its sender.
      if (mode === 'shared' && sessionEnded && !sentSessionEnd) {
        // Announce at once; clear after the first clear settles.
        const announced = broadcastInvalidation(true);
        const previous = clearing;
        clearing = (async () => {
          await Promise.all([announced, previous]);
          await clearStorage('local', true);
        })();
      }
      await clearing;
      return;
    }
    invalidated = true;
    cache.dispose();
    clearing = clearStorage(mode, sessionEnded);
    await clearing;
  }

  let reported: 'none' | 'reset' | 'ended' = 'none';
  /** Tells the owner once per kind; a later session end still upgrades a reset. */
  function reportRemote(sessionEnded: boolean): void {
    if (disposed || reported === 'ended') return;
    if (!sessionEnded && reported === 'reset') return;
    reported = sessionEnded ? 'ended' : 'reset';
    options.onRemoteInvalidation(sessionEnded, clear('remote'));
  }

  async function connect(): Promise<void> {
    const name = await namespace;
    if (disposed || invalidated || typeof BroadcastChannel === 'undefined')
      return;
    try {
      channel = new BroadcastChannel(channelName(name));
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as {
        kind?: string;
        sessionEnded?: boolean;
      } | null;
      if (message?.kind !== 'invalidate') return;
      reportRemote(message.sessionEnded === true);
    };
    // A sign-out clears the durable marker before its broadcast goes out, so a
    // session that connects after missing that broadcast still learns of it.
    if (signedOut()) reportRemote(true);
  }
  void connect();

  return {
    cache,
    invalidate: (sessionEnded = false, broadcast = true) =>
      clear(broadcast ? 'shared' : 'local', sessionEnded),
    dispose(sessionEnded = false) {
      disposed = true;
      channel?.close();
      // clear() disposes the cache synchronously, or already has.
      return clear('shared', sessionEnded);
    },
  };
}
