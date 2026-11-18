import { expect, it } from 'vitest';
import { createMutationQueueOwner } from './mutation-queue-owner';

/**
 * Exclusive Web Locks shared by every page of one origin. `pageGone` drops the
 * lock a page held, as the browser does when the page unloads. `isHeld` says
 * whether a lock is held now.
 */
function originLocks() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const dropped = new Map<string, () => void>();
  const locks = {
    async request(
      name: string,
      callback: (lock: Lock | null) => Promise<unknown> | unknown
    ): Promise<unknown> {
      // Browsers grant a lock asynchronously, even a free one.
      await Promise.resolve();
      if (held.has(name)) {
        await new Promise<void>((grant) => {
          waiting.set(name, [...(waiting.get(name) ?? []), grant]);
        });
      }
      held.add(name);
      try {
        return await Promise.race([
          callback({ name, mode: 'exclusive' }),
          new Promise((drop) => dropped.set(name, () => drop(undefined))),
        ]);
      } finally {
        dropped.delete(name);
        held.delete(name);
        const [next, ...rest] = waiting.get(name) ?? [];
        waiting.set(name, rest);
        next?.();
      }
    },
  } as unknown as LockManager;
  return {
    locks,
    pageGone: (owner: string) =>
      dropped.get(`graphql-cache-mutation-owner:${owner}`)?.(),
    isHeld: (owner: string) =>
      held.has(`graphql-cache-mutation-owner:${owner}`),
  };
}

/** One page's `pagehide` and `pageshow`. */
function page() {
  const target = new EventTarget();
  return {
    target,
    hide: () => target.dispatchEvent(new Event('pagehide')),
    show: (persisted: boolean) =>
      target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted })),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Whether `departure` settles while the event loop drains. */
async function settles(departure: Promise<void> | undefined): Promise<boolean> {
  if (!departure) return false;
  return await Promise.race([
    (async () => {
      await departure;
      return true;
    })(),
    (async () => {
      await flush();
      return false;
    })(),
  ]);
}

it('holds plain claims, and live ones only while it holds their owner', async () => {
  const { locks } = originLocks();
  const lifecycle = page();
  const owner = createMutationQueueOwner('here', locks, lifecycle.target);
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here:0');
  expect(owner.holds('exchange:here')).toBe(true);
  expect(owner.holds('exchange-live:here:0')).toBe(true);
  lifecycle.hide();
  expect(owner.holds('exchange:here')).toBe(true);
  expect(owner.holds('exchange-live:here:0')).toBe(false);
  lifecycle.show(true);
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here:1');
  expect(owner.holds('exchange-live:here:0')).toBe(false);
  expect(owner.holds('exchange-live:here:1')).toBe(true);
});

it('claims as a plain owner until the page holds its lock', async () => {
  const { locks } = originLocks();
  const owner = createMutationQueueOwner('here', locks, page().target);
  expect(owner.claimOwner()).toBe('exchange:here');
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here:0');
});

it('without Web Locks, claims as a plain owner and judges no other page', () => {
  const owner = createMutationQueueOwner('here', undefined, page().target);
  expect(owner.claimOwner()).toBe('exchange:here');
  expect(owner.departed('exchange-live:gone')).toBeUndefined();
});

it('settles once the page behind a live owner goes', async () => {
  const { locks, pageGone } = originLocks();
  const before = createMutationQueueOwner('before', locks, page().target);
  const after = createMutationQueueOwner('after', locks, page().target);
  await flush();
  const departure = after.departed(before.claimOwner());
  expect(await settles(departure)).toBe(false);
  // Asking again shares the one wait.
  expect(after.departed(before.claimOwner())).toBe(departure);
  pageGone(before.claimOwner());
  expect(await settles(departure)).toBe(true);
});

it('never judges its own owners or one that held no lock', async () => {
  const { locks } = originLocks();
  const owner = createMutationQueueOwner('here', locks, page().target);
  await flush();
  expect(owner.departed('exchange-live:here:0')).toBeUndefined();
  // An owner from before a restore from the back/forward cache.
  expect(owner.departed('exchange-live:here:3')).toBeUndefined();
  expect(owner.departed('exchange:here')).toBeUndefined();
  expect(owner.departed('exchange:older-bundle')).toBeUndefined();
});

it('lets its lock go on pagehide and takes a new owner when restored from the cache', async () => {
  const { locks } = originLocks();
  const cached = page();
  const owner = createMutationQueueOwner('here', locks, cached.target);
  const other = createMutationQueueOwner('other', locks, page().target);
  await flush();
  const hidden = other.departed(owner.claimOwner());
  expect(await settles(hidden)).toBe(false);

  cached.hide();
  // Others may now release its claims, so it makes none as that owner.
  expect(owner.claimOwner()).toBe('exchange:here');
  expect(await settles(hidden)).toBe(true);

  cached.show(true);
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here:1');
  expect(await settles(other.departed(owner.claimOwner()))).toBe(false);
});

it('gives the lock back at once when hidden before it is granted', async () => {
  const { locks, isHeld } = originLocks();
  const hiding = page();
  const owner = createMutationQueueOwner('here', locks, hiding.target);
  hiding.hide();
  await flush();
  expect(owner.claimOwner()).toBe('exchange:here');
  expect(isHeld('exchange-live:here:0')).toBe(false);
});

it('keeps its owner through a pageshow that is not a restore', async () => {
  const { locks, isHeld } = originLocks();
  const shown = page();
  const owner = createMutationQueueOwner('here', locks, shown.target);
  await flush();
  shown.show(false);
  // A restore without a pagehide first changes nothing either.
  shown.show(true);
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here:0');
  expect(isHeld('exchange-live:here:1')).toBe(false);
});
