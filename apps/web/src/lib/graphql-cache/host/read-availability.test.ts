import { expect, it } from 'vitest';
import { CacheReadAvailability } from './read-availability';

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
