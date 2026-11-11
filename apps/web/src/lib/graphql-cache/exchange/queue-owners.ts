/**
 * Leases left behind by mutation queue runners that are gone.
 *
 * A runner leases the head of the queue while it sends it, and nothing behind
 * the head runs until that lease is settled or expires. A page that reloads or
 * closes mid-attempt leaves its lease behind for the full lease time.
 *
 * Each runner therefore holds a Web Lock for as long as its page lives, and
 * writes down under its own storage key which lease it holds. A recorded
 * runner whose lock can be taken belongs to a page that is gone. Whoever takes
 * the lock reads the lease that runner left and gives it back to the queue.
 *
 * Not at once: the gone page's request may still reach the server, and a write
 * queued behind it must not overtake it. A lease is handed over only once it
 * is old enough that its request can no longer be on the wire.
 */

import { fireAndForget } from '@core/util/fireAndForget';

const SURFACE = 'graphql-cache-mutation-queue';
const KEY_PREFIX = 'graphql-cache:queue-owner:';
/** A lease older than this has run out, whatever storage it belongs to. */
const STALE_RECORD_MS = 10 * 60_000;

type Lease = { transactionId: string; leaseGeneration: string };
type OwnerRecord = { generation: string; at: number } & Partial<Lease>;

export type AbandonedLease = Lease & { owner: string };

export type QueueOwners = {
  /** Writes down this runner's storage and, while it holds one, its lease. */
  record(generation: string, lease?: Lease): void;
  /** Whether another runner is on record: a cheap check before taking locks. */
  hasCandidates(): boolean;
  /**
   * Takes the leases that gone runners of this storage left at least
   * `settledAfterMs` ago, forgetting each runner. `pendingUntil` is when the
   * youngest lease still held back becomes old enough.
   */
  abandoned(
    generation: string,
    settledAfterMs: number
  ): Promise<{ leases: AbandonedLease[]; pendingUntil?: number }>;
  dispose(): void;
};

export const NO_QUEUE_OWNERS: QueueOwners = {
  record: () => undefined,
  hasCandidates: () => false,
  abandoned: async () => ({ leases: [] }),
  dispose: () => undefined,
};

type OwnerStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

function parseRecord(value: string | null): OwnerRecord | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Partial<OwnerRecord>;
    return typeof record.generation === 'string' &&
      typeof record.at === 'number'
      ? (record as OwnerRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tracks runner liveness for `owner`. Without Web Locks or storage it tracks
 * nothing, and an abandoned lease simply runs out as before.
 */
export function createQueueOwners(
  owner: string,
  locks: Pick<LockManager, 'request'> | undefined = globalThis.navigator?.locks,
  storage: OwnerStorage | undefined = globalThis.localStorage,
  now: () => number = Date.now
): QueueOwners {
  if (!locks || !storage) return NO_QUEUE_OWNERS;
  const ownKey = KEY_PREFIX + owner;
  let release: (() => void) | undefined;
  let disposed = false;
  let latest: OwnerRecord | undefined;

  const otherKeys = () => {
    const keys: string[] = [];
    try {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(KEY_PREFIX) && key !== ownKey) keys.push(key);
      }
    } catch {
      // Storage that cannot be read lists nobody.
    }
    return keys;
  };

  /** Resolves once this page holds its runner's lock, for as long as it lives. */
  const alive = new Promise<boolean>((resolve) => {
    const hold = async () => {
      try {
        await locks.request(ownKey, { mode: 'exclusive' }, async (lock) => {
          resolve(lock !== null && !disposed);
          if (disposed) return;
          await new Promise<void>((done) => {
            release = done;
          });
        });
      } catch {
        resolve(false);
      }
    };
    fireAndForget(hold(), SURFACE);
  });

  // On record only once its lock is held: a recorded runner without a lock is
  // taken for gone.
  const write = async () => {
    if (!(await alive) || disposed || !latest) return;
    try {
      storage.setItem(ownKey, JSON.stringify(latest));
    } catch {
      // Without a record this runner's lease runs out by itself.
    }
  };

  /** Called holding a gone runner's lock: its lease, if it is this storage's. */
  const take = (
    key: string,
    generation: string,
    settledAfterMs: number
  ): AbandonedLease | { pendingUntil: number } | undefined => {
    const record = parseRecord(storage.getItem(key));
    if (!record) {
      storage.removeItem(key);
      return undefined;
    }
    const ours = record.generation === generation;
    const lease =
      ours && record.transactionId && record.leaseGeneration
        ? {
            owner: key.slice(KEY_PREFIX.length),
            transactionId: record.transactionId,
            leaseGeneration: record.leaseGeneration,
          }
        : undefined;
    // Its request may still be on its way to the server: ask again later.
    if (lease && now() - record.at < settledAfterMs)
      return { pendingUntil: record.at + settledAfterMs };

    // Another storage's page may still want a fresh record; a stale one is dead weight.
    if (ours || now() - record.at > STALE_RECORD_MS) storage.removeItem(key);
    return lease;
  };

  return {
    record(generation, lease) {
      latest = { generation, at: now(), ...lease };
      fireAndForget(write(), SURFACE);
    },
    hasCandidates: () => otherKeys().length > 0,
    async abandoned(generation, settledAfterMs) {
      const leases: AbandonedLease[] = [];
      let pendingUntil: number | undefined;
      for (const key of otherKeys()) {
        try {
          const taken = await locks.request(
            key,
            { mode: 'exclusive', ifAvailable: true },
            (lock) => (lock ? take(key, generation, settledAfterMs) : undefined)
          );
          if (!taken) continue;
          if ('pendingUntil' in taken)
            pendingUntil = Math.min(
              pendingUntil ?? Infinity,
              taken.pendingUntil
            );
          else leases.push(taken);
        } catch {
          // A lock that cannot be probed leaves its lease to run out.
        }
      }
      return { leases, pendingUntil };
    },
    dispose() {
      disposed = true;
      release?.();
    },
  };
}
