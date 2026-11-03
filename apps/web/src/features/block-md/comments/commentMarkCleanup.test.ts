import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import { expect, it, vi } from 'vitest';
import { createCommentMarkCleanup } from './commentMarkCleanup';

it('keeps failed removals for a new drain without retrying successful entries', async () => {
  const store = new InMemoryWALStore<string>();
  await store.append('failed');
  await store.append('accepted');
  const remove = vi.fn(async (id: string) => id === 'accepted');
  await createCommentMarkCleanup(store, remove).flush();
  expect((await store.getAll()).map((entry) => entry.update)).toEqual([
    'failed',
  ]);

  const retry = vi.fn(async () => true);
  await createCommentMarkCleanup(store, retry).flush();
  expect(retry).toHaveBeenCalledExactlyOnceWith('failed');
  expect(await store.getAll()).toEqual([]);
});

it('retains intents when lookup or transport throws', async () => {
  const store = new InMemoryWALStore<string>();
  const remove = vi.fn().mockRejectedValue(new Error('offline'));
  await expect(
    createCommentMarkCleanup(store, remove).enqueue('cancelled')
  ).rejects.toThrow('offline');
  expect((await store.getAll()).map((entry) => entry.update)).toEqual([
    'cancelled',
  ]);
});

it('drains an intent appended while another removal is pending', async () => {
  const store = new InMemoryWALStore<string>();
  let finish!: (accepted: boolean) => void;
  let start!: () => void;
  const first = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const remove = vi.fn(async (id: string) => {
    if (id !== 'first') return true;
    start();
    return first;
  });
  const queue = createCommentMarkCleanup(store, remove);
  const a = queue.enqueue('first');
  await started;
  const b = queue.enqueue('second');
  finish(true);
  await Promise.all([a, b]);
  expect(remove.mock.calls).toEqual([['first'], ['second']]);
  expect(await store.getAll()).toEqual([]);
});

it.each([false, true])(
  'retries a reconnect that arrives during a failed attempt, throws: %s',
  async (throws) => {
    const store = new InMemoryWALStore<string>();
    await store.append('cancelled');
    let finish!: (accepted: boolean) => void;
    let start!: () => void;
    const result = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const remove = vi
      .fn()
      .mockResolvedValue(true)
      .mockImplementationOnce(async () => {
        start();
        await result;
        if (throws) throw new Error('offline');
        return false;
      });
    const queue = createCommentMarkCleanup(store, remove);
    const attempt = queue.flush();
    await started;
    const reconnect = queue.flush();
    finish(false);
    await Promise.all([attempt, reconnect]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await store.getAll()).toEqual([]);
  }
);
