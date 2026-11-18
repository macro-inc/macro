/**
 * Lease owners for the durable mutation queue, and how a runner learns that
 * the page behind another owner has gone.
 *
 * A claim leases the queue head for `QUEUE_LEASE_MS`. A page that reloads or
 * closes mid-attempt never settles its claim, so the head, and every mutation
 * behind it, would wait out the lease. Each page therefore holds a Web Lock
 * named after its live owner while it is shown, and lets it go on `pagehide`;
 * the browser also releases it when the page goes. A runner that finds the
 * head leased by another live owner asks for that owner's lock: the request
 * is granted only once the page holding it has been hidden or gone, and the
 * runner then releases the claim.
 *
 * Hiding may put the page in the back/forward cache rather than end it. An
 * engine may drop a cached page's locks, and others already know its owner
 * left, so a page restored from the cache claims under a new live owner once
 * it holds that owner's lock.
 *
 * Only claims made while the page holds its lock use the live prefix. Claims
 * made before the lock is granted, while hidden, without Web Locks, or by
 * older bundles use the plain prefix and are never released early: their page
 * may still be sending.
 */

import { fireAndForget } from '@core/util/fireAndForget';

const LIVE_OWNER_PREFIX = 'exchange-live:';
const PLAIN_OWNER_PREFIX = 'exchange:';
const OWNER_LOCK_PREFIX = 'graphql-cache-mutation-owner:';

export type MutationQueueOwner = {
  /** Owner for a claim made now: the live owner while this page holds its lock. */
  claimOwner: () => string;
  /**
   * Whether a claim this page made under `owner` is still its own to send:
   * false once the page has let that live owner go, since another page may
   * have released the claim.
   */
  holds: (owner: string) => boolean;
  /**
   * Settles once `owner`'s page has been hidden or gone. Undefined when that
   * cannot be known: this page's own owners, and owners that held no lock.
   */
  departed: (owner: string) => Promise<void> | undefined;
};

/** Where `pagehide` and `pageshow` arrive; the window in the app. */
export type PageLifecycle = Pick<EventTarget, 'addEventListener'>;

function ownerLockName(owner: string): string {
  return `${OWNER_LOCK_PREFIX}${owner}`;
}

/** Settles once whoever holds `name` has released it. */
async function untilReleased(locks: LockManager, name: string): Promise<void> {
  await locks.request(name, () => undefined);
}

function restoredFromCache(event: Event): boolean {
  return 'persisted' in event && event.persisted === true;
}

export function createMutationQueueOwner(
  clientId: string,
  locks: LockManager | undefined,
  page: PageLifecycle | undefined = typeof addEventListener === 'function'
    ? globalThis
    : undefined
): MutationQueueOwner {
  const plainOwner = `${PLAIN_OWNER_PREFIX}${clientId}`;
  const ownLivePrefix = `${LIVE_OWNER_PREFIX}${clientId}:`;
  let incarnation = 0;
  /** The live owner while this page holds its lock. */
  let live: string | undefined;
  /** Lets the current lock go, or gives it back as soon as it is granted. */
  let letGo: (() => void) | undefined;
  const departures = new Map<string, Promise<void>>();

  function hold(lockManager: LockManager): void {
    const name = `${ownLivePrefix}${incarnation}`;
    incarnation += 1;
    let hidden = false;
    let resolveHidden = () => {};
    const whileShown = new Promise<void>((resolve) => {
      resolveHidden = resolve;
    });
    letGo = () => {
      hidden = true;
      if (live === name) live = undefined;
      resolveHidden();
    };
    fireAndForget(
      lockManager.request(ownerLockName(name), async () => {
        if (hidden) return;
        live = name;
        await whileShown;
      }),
      'graphql-cache-mutation-queue'
    );
  }

  if (locks) {
    hold(locks);
    page?.addEventListener('pagehide', () => {
      letGo?.();
      letGo = undefined;
    });
    page?.addEventListener('pageshow', (event) => {
      if (restoredFromCache(event) && !letGo) hold(locks);
    });
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
    claimOwner: () => live ?? plainOwner,
    holds: (claimedAs) =>
      !claimedAs.startsWith(LIVE_OWNER_PREFIX) || claimedAs === live,
    departed(owner) {
      if (
        !locks ||
        !owner.startsWith(LIVE_OWNER_PREFIX) ||
        owner.startsWith(ownLivePrefix)
      )
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
