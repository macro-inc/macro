import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftAutosave } from './draft-autosave';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

it('coalesces local snapshots behind a slow write and reports durability only after the newest completes', async () => {
  vi.useFakeTimers();
  const first = Promise.withResolvers<void>();
  let current = 'first';
  const writes: string[] = [];
  const autosave = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftAutosave({
      capture: () => current,
      persist: vi.fn(async () => {}),
      paused: () => false,
      saveLocalSnapshot: async (snapshot) => {
        writes.push(snapshot);
        if (snapshot === 'first') await first.promise;
      },
    });
  });
  autosave.schedule();
  await vi.advanceTimersByTimeAsync(0);
  current = 'middle';
  autosave.schedule();
  current = 'latest';
  autosave.schedule();
  expect(autosave.localSaveState()).toBe('saving');
  first.resolve();
  await autosave.flushLocal();
  expect(writes).toEqual(['first', 'latest']);
  expect(autosave.localSaveState()).toBe('saved');
  autosave.cancel();
});

it('does not enqueue a save after a disk failure and lets the next local save recover', async () => {
  const persist = vi.fn(async () => {});
  const local = vi
    .fn<(snapshot: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Disk full'))
    .mockResolvedValue(undefined);
  const autosave = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftAutosave({
      capture: () => 'draft',
      persist,
      paused: () => false,
      saveLocalSnapshot: local,
    });
  });
  await expect(autosave.save()).rejects.toThrow('Disk full');
  expect(autosave.localSaveState()).toBe('failed');
  expect(persist).not.toHaveBeenCalled();
  await autosave.save();
  expect(autosave.localSaveState()).toBe('saved');
  expect(persist).toHaveBeenCalledOnce();
});
