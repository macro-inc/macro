import { beforeEach, expect, it } from 'vitest';
import { createFakeWebLocks } from './fake-web-locks';
import { createQueueOwners } from './queue-owners';

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
const lease = { transactionId: '7', leaseGeneration: '2', itemId: 'item' };
let locks: ReturnType<typeof createFakeWebLocks>;
let storage: ReturnType<typeof createStorage>;
let clock: number;
beforeEach(() => {
  locks = createFakeWebLocks();
  storage = createStorage();
  clock = 1_000_000;
});

function page(owner: string) {
  const self = {};
  const owners = createQueueOwners(
    owner,
    locks.forPage(self),
    storage,
    () => clock
  );
  return { owners, die: () => locks.release(self) };
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
  expect(second.owners.othersOnRecord()).toBe(true);
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
  dead.owners.record('storage', { ...lease, transactionId: '8' });
  const second = page('second');
  await tick();
  dead.die();
  clock += GRACE;

  expect(await leasesOf(second.owners)).toEqual([
    { owner: 'dead', ...lease, transactionId: '8' },
  ]);
});

it('forgets a gone runner that held no lease', async () => {
  const dead = page('dead');
  dead.owners.record('storage');
  const second = page('second');
  await tick();
  dead.die();

  expect(await leasesOf(second.owners)).toEqual([]);
  expect(second.owners.othersOnRecord()).toBe(false);
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
  expect(second.owners.othersOnRecord()).toBe(false);
});

it('tracks nothing without Web Locks', async () => {
  const owners = createQueueOwners('lonely', undefined, storage);
  owners.record('storage', lease);
  await tick();
  expect(storage.length).toBe(0);
  expect(await owners.abandoned('storage', GRACE)).toEqual({ leases: [] });
});

it('ignores a record it cannot read', async () => {
  const second = page('second');
  await tick();
  storage.setItem('graphql-cache:queue-owner:broken', '{"generation":7}');
  storage.setItem(
    'graphql-cache:queue-owner:half',
    JSON.stringify({
      generation: 'storage',
      at: 0,
      lease: { transactionId: 7 },
    })
  );

  expect(await leasesOf(second.owners)).toEqual([]);
  expect(second.owners.othersOnRecord()).toBe(false);
});
