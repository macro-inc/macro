import { beforeEach, expect, it } from 'vitest';
import { createQueueOwners } from './queue-owners';

/** Web Locks for several pages in one process; a page that dies drops its locks. */
function createLocks() {
  const held = new Map<string, object>();
  return (page: object): Pick<LockManager, 'request'> & { die(): void } => ({
    async request(name: string, ...rest: unknown[]) {
      const options = rest.length > 1 ? (rest[0] as LockOptions) : {};
      const callback = rest.at(-1) as (lock: Lock | null) => unknown;
      if (held.has(name)) {
        if (options.ifAvailable) return await callback(null);
        throw new Error(`${name} is held and this fake never queues`);
      }
      held.set(name, page);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        if (held.get(name) === page) held.delete(name);
      }
    },
    die() {
      for (const [name, holder] of held) if (holder === page) held.delete(name);
    },
  });
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const lease = { transactionId: '7', leaseGeneration: '2' };
let locksFor: ReturnType<typeof createLocks>;
let storage: ReturnType<typeof createStorage>;
let clock: number;
beforeEach(() => {
  locksFor = createLocks();
  storage = createStorage();
  clock = 1_000_000;
});

function page(owner: string) {
  const locks = locksFor({});
  const owners = createQueueOwners(owner, locks, storage, () => clock);
  return { owners, die: locks.die };
}

const GRACE = 60_000;
const leasesOf = async (
  owners: ReturnType<typeof page>['owners'],
  generation = 'storage'
) => (await owners.abandoned(generation, GRACE)).leases;

it('hands over the lease of a runner whose page is gone', async () => {
  const first = page('first');
  first.owners.record('storage', lease);
  const second = page('second');
  second.owners.record('storage');
  await tick();
  clock += GRACE;
  // Alive: its lease is its own business.
  expect(await leasesOf(second.owners)).toEqual([]);

  first.die();
  expect(second.owners.hasCandidates()).toBe(true);
  expect(await leasesOf(second.owners)).toEqual([{ owner: 'first', ...lease }]);
});

it('holds a lease back while its request may still be on the wire', async () => {
  const dead = page('dead');
  dead.owners.record('storage', lease);
  const second = page('second');
  await tick();
  dead.die();
  clock += GRACE - 1_000;

  expect(await second.owners.abandoned('storage', GRACE)).toEqual({
    leases: [],
    pendingUntil: clock + 1_000,
  });
  clock += 1_000;
  expect(await second.owners.abandoned('storage', GRACE)).toEqual({
    leases: [{ owner: 'dead', ...lease }],
    pendingUntil: undefined,
  });
});

it('hands a lease over once, then forgets the runner', async () => {
  const dead = page('dead');
  dead.owners.record('storage', lease);
  const second = page('second');
  const third = page('third');
  await tick();
  dead.die();
  clock += GRACE;

  expect(await leasesOf(second.owners)).toHaveLength(1);
  expect(await leasesOf(third.owners)).toEqual([]);
  expect(await leasesOf(second.owners)).toEqual([]);
});

it('reports the newest lease a runner recorded', async () => {
  const dead = page('dead');
  dead.owners.record('storage', lease);
  dead.owners.record('storage', { transactionId: '8', leaseGeneration: '1' });
  const second = page('second');
  await tick();
  dead.die();
  clock += GRACE;

  expect(await leasesOf(second.owners)).toEqual([
    { owner: 'dead', transactionId: '8', leaseGeneration: '1' },
  ]);
});

it('forgets a gone runner that held no lease', async () => {
  const dead = page('dead');
  dead.owners.record('storage');
  const second = page('second');
  await tick();
  dead.die();

  expect(await leasesOf(second.owners)).toEqual([]);
  expect(second.owners.hasCandidates()).toBe(false);
});

it('leaves another storage its runners until their leases have run out', async () => {
  const dead = page('dead');
  dead.owners.record('other-storage', lease);
  const second = page('second');
  await tick();
  dead.die();
  clock += GRACE;

  expect(await leasesOf(second.owners)).toEqual([]);
  expect(await leasesOf(second.owners, 'other-storage')).toHaveLength(1);

  const stale = page('stale');
  stale.owners.record('other-storage', lease);
  await tick();
  stale.die();
  clock += 11 * 60_000;
  expect(await leasesOf(second.owners)).toEqual([]);
  expect(second.owners.hasCandidates()).toBe(false);
});

it('tracks nothing without Web Locks', async () => {
  const owners = createQueueOwners('lonely', undefined, storage);
  owners.record('storage', lease);
  await tick();
  expect(storage.length).toBe(0);
  expect(await owners.abandoned('storage', GRACE)).toEqual({ leases: [] });
});
