import { expect, it } from 'vitest';
import { createMutationQueueOwner } from './mutation-queue-owner';

/**
 * Exclusive Web Locks shared by every page of one origin. `pageGone` drops the
 * lock a page held, as the browser does when the page unloads.
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

it('claims as a plain owner until the page holds its lock', async () => {
  const { locks } = originLocks();
  const owner = createMutationQueueOwner('here', locks);
  expect(owner.claimOwner()).toBe('exchange:here');
  await flush();
  expect(owner.claimOwner()).toBe('exchange-live:here');
});

it('without Web Locks, claims as a plain owner and judges no other page', () => {
  const owner = createMutationQueueOwner('here', undefined);
  expect(owner.claimOwner()).toBe('exchange:here');
  expect(owner.departed('exchange-live:gone')).toBeUndefined();
});

it('settles once the page behind a live owner goes', async () => {
  const { locks, pageGone } = originLocks();
  const before = createMutationQueueOwner('before', locks);
  const after = createMutationQueueOwner('after', locks);
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
  const owner = createMutationQueueOwner('here', locks);
  await flush();
  expect(owner.departed('exchange-live:here')).toBeUndefined();
  expect(owner.departed('exchange:here')).toBeUndefined();
  expect(owner.departed('exchange:older-bundle')).toBeUndefined();
});
