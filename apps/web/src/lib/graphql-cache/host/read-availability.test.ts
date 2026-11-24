import { expect, it, vi } from 'vitest';
import {
  CacheReadAvailability,
  cacheRequestStamp,
  isReadOnlyCacheRequest,
} from './read-availability';

it('interrupts a read waiting for initialization without interrupting a write or replaying either', async () => {
  const availability = new CacheReadAvailability();
  const initialized = Promise.withResolvers<void>();
  const read = availability.waitUntilReady(() => initialized.promise, 'read');
  const rejected = expect(read).rejects.toThrow('handoff');
  const write = availability.waitUntilReady(() => initialized.promise, 'write');
  availability.block(new Error('handoff'));
  await rejected;
  await expect(
    availability.waitUntilReady(() => initialized.promise, 'read')
  ).rejects.toThrow('handoff');
  availability.resume();
  initialized.resolve();
  await write;
  await availability.waitUntilReady(() => initialized.promise, 'read');
});

it('gives up waiting writes too while nothing can open the database, but not a held one', async () => {
  const availability = new CacheReadAvailability();
  const initialized = Promise.withResolvers<void>();
  const wait = (admission: 'read' | 'write' | 'held') =>
    availability.waitUntilReady(() => initialized.promise, admission);
  const refused = Promise.all(
    (['read', 'write'] as const).map((admission) =>
      expect(wait(admission)).rejects.toThrow('outage')
    )
  );
  const held = wait('held');

  availability.blockAll(new Error('outage'));

  await refused;
  initialized.resolve();
  await held;
});

it('ends an aborted wait as superseded, not as timed out', async () => {
  const availability = new CacheReadAvailability();
  const initialize = vi.fn(() => new Promise<void>(() => undefined));
  const wait = (signal: AbortSignal) =>
    availability.waitUntilReady(initialize, 'read', {
      timeoutMs: 10,
      error: () => new Error('timed out'),
      signal,
      superseded: () => new Error('superseded'),
    });
  const abort = new AbortController();
  const waiting = expect(wait(abort.signal)).rejects.toThrow('superseded');
  abort.abort();
  await waiting;
  initialize.mockClear();
  await expect(wait(abort.signal)).rejects.toThrow('superseded');
  expect(initialize).not.toHaveBeenCalled();
});

it.each([
  'people-context',
  'people-search',
  'people-references',
  'people-sql',
  'contact-snapshot',
] as const)('classifies %s as a read-only request', (kind) => {
  expect(isReadOnlyCacheRequest(kind)).toBe(true);
  expect(isReadOnlyCacheRequest('people-update')).toBe(false);
});

it('preserves read/write startup continuation order', async () => {
  const availability = new CacheReadAvailability();
  const initialized = Promise.withResolvers<void>();
  const order: string[] = [];
  const wait = async (admission: 'read' | 'write') => {
    await availability.waitUntilReady(() => initialized.promise, admission);
    order.push(admission);
  };
  const pending = [wait('read'), wait('write'), wait('read'), wait('write')];
  initialized.resolve();
  await Promise.all(pending);
  expect(order).toEqual(['read', 'write', 'read', 'write']);
});

it.each([
  ['read', 'observed'],
  ['search', 'observed'],
  ['people-search', 'observed'],
  ['invalidate', 'observed'],
  ['delete-records', 'observed'],
  ['init', 'none'],
  ['transition-authority', 'none'],
  ['claim-next-mutation', 'none'],
  ['rollback-optimistic-write', 'none'],
  ['teardown', 'none'],
  ['clear', 'none'],
  ['write', 'captured'],
  ['hydrate', 'captured'],
  ['enqueue-optimistic-mutation', 'captured'],
  ['commit-optimistic-write', 'captured'],
  ['calendar-commit', 'captured'],
  ['people-update', 'captured'],
  ['contact-reconcile', 'captured'],
] as const)('%s carries the %s generation', (kind, stamp) => {
  expect(cacheRequestStamp(kind)).toBe(stamp);
});

it('requires a captured stamp from a request kind it does not know', () => {
  expect(cacheRequestStamp('a-later-write' as never)).toBe('captured');
});
