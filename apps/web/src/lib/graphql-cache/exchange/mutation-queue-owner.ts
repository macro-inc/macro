/**
 * Lease owners for the durable mutation queue, and how a runner learns that
 * the page behind another owner has gone.
 *
 * A claim leases the queue head for `QUEUE_LEASE_MS`. A page that reloads or
 * closes mid-attempt never settles its claim, so the head, and every mutation
 * behind it, would wait out the lease. Each page therefore holds a Web Lock
 * named after its owner for as long as it lives, and the browser releases the
 * lock when the page goes. A runner that finds the head leased by another
 * owner asks for that owner's lock: the request is granted only once the page
 * holding it has gone, and the runner then releases the claim.
 *
 * Only claims made while the page holds its lock use the live prefix. Claims
 * made before the lock is granted, without Web Locks, or by older bundles use
 * the plain prefix and are never released early: their page may still be
 * sending.
 */

import { fireAndForget } from '@core/util/fireAndForget';

const LIVE_OWNER_PREFIX = 'exchange-live:';
const PLAIN_OWNER_PREFIX = 'exchange:';
const OWNER_LOCK_PREFIX = 'graphql-cache-mutation-owner:';

export type MutationQueueOwner = {
  /** Owner for a claim made now: the live owner once this page holds its lock. */
  claimOwner: () => string;
  /**
   * Settles once `owner`'s page has gone. Undefined when that cannot be
   * known: this page's own owners, and owners that held no lock.
   */
  departed: (owner: string) => Promise<void> | undefined;
};

function ownerLockName(owner: string): string {
  return `${OWNER_LOCK_PREFIX}${owner}`;
}

/** Holds `name` until the page goes; the browser then releases it. */
async function holdForPageLifetime(
  locks: LockManager,
  name: string,
  onHeld: () => void
): Promise<void> {
  await locks.request(name, async () => {
    onHeld();
    await new Promise<never>(() => {});
  });
}

/** Settles once whoever holds `name` has released it. */
async function untilReleased(locks: LockManager, name: string): Promise<void> {
  await locks.request(name, () => undefined);
}

export function createMutationQueueOwner(
  clientId: string,
  locks: LockManager | undefined
): MutationQueueOwner {
  const plainOwner = `${PLAIN_OWNER_PREFIX}${clientId}`;
  const liveOwner = `${LIVE_OWNER_PREFIX}${clientId}`;
  let held = false;
  const departures = new Map<string, Promise<void>>();
  if (locks) {
    fireAndForget(
      holdForPageLifetime(locks, ownerLockName(liveOwner), () => {
        held = true;
      }),
      'graphql-cache-mutation-queue'
    );
  }

  async function watch(lockManager: LockManager, owner: string): Promise<void> {
    try {
      await untilReleased(lockManager, ownerLockName(owner));
    } catch (error) {
      // A later drain may ask again.
      departures.delete(owner);
      throw error;
    }
  }

  return {
    claimOwner: () => (held ? liveOwner : plainOwner),
    departed(owner) {
      if (!locks || !owner.startsWith(LIVE_OWNER_PREFIX) || owner === liveOwner)
        return undefined;
      let departure = departures.get(owner);
      if (!departure) {
        departure = watch(locks, owner);
        departures.set(owner, departure);
      }
      return departure;
    },
  };
}
