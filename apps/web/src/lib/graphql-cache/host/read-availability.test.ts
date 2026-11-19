import { expect, it } from 'vitest';
import {
  CacheReadAvailability,
  cacheRequestStamp,
  isReadOnlyCacheRequest,
} from './read-availability';

it('interrupts a read waiting for initialization without interrupting a write or replaying either', async () => {
  const availability = new CacheReadAvailability();
  const initialized = Promise.withResolvers<void>();
  const read = availability.waitUntilReady(() => initialized.promise, true);
  const rejected = expect(read).rejects.toThrow('handoff');
  const write = availability.waitUntilReady(() => initialized.promise, false);
  availability.block(new Error('handoff'));
  await rejected;
  await expect(
    availability.waitUntilReady(() => initialized.promise, true)
  ).rejects.toThrow('handoff');
  availability.resume();
  initialized.resolve();
  await write;
  await availability.waitUntilReady(() => initialized.promise, true);
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
  const order: boolean[] = [];
  const wait = async (readOnly: boolean) => {
    await availability.waitUntilReady(() => initialized.promise, readOnly);
    order.push(readOnly);
  };
  const pending = [wait(true), wait(false), wait(true), wait(false)];
  initialized.resolve();
  await Promise.all(pending);
  expect(order).toEqual([true, false, true, false]);
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
