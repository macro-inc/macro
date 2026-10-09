import { createMemo, createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftAutosave } from './draft-autosave';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

it.each([false, true])(
  'suppresses a delivery flush acknowledgement until another edit (failure=%s)',
  async (fails) => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => {
      if (fails) throw new Error('Delivery preparation failed');
    });
    const local = vi.fn(async () => {});
    const autosave = createRoot((dispose) => {
      disposers.push(dispose);
      return createDraftAutosave({
        capture: () => 'draft',
        persist,
        saveLocalSnapshot: local,
        paused: () => false,
      });
    });
    autosave.schedule();
    await autosave.flushLocal();
    const flush = autosave.save(undefined, { acknowledge: false });
    expect(autosave.acknowledgeSaved()).toBe(false);
    if (fails)
      await expect(flush).rejects.toThrow('Delivery preparation failed');
    else await flush;
    expect(local).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(autosave.acknowledgeSaved()).toBe(false);
    fails = false;
    autosave.schedule();
    await autosave.flushLocal();
    expect(autosave.acknowledgeSaved()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(autosave.acknowledgeSaved()).toBe(true);
  }
);

it('keeps input active through continuous edits without delaying local saves', async () => {
  vi.useFakeTimers();
  const local = vi.fn(async () => {});
  const persist = vi.fn(async () => {});
  const autosave = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftAutosave({
      capture: () => 'draft',
      saveLocalSnapshot: local,
      persist,
      paused: () => false,
    });
  });
  for (let edit = 0; edit < 3; edit++) {
    autosave.schedule();
    await autosave.flushLocal();
    expect(autosave.localSaveState()).toBe('saved');
    expect(autosave.acknowledgeSaved()).toBe(false);
    expect(local).toHaveBeenCalledTimes(edit + 1);
    await vi.advanceTimersByTimeAsync(200);
    expect(autosave.acknowledgeSaved()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  }
  await vi.advanceTimersByTimeAsync(299);
  expect(autosave.acknowledgeSaved()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(autosave.acknowledgeSaved()).toBe(true);
  await autosave.settled();
  expect(persist).toHaveBeenCalledOnce();

  autosave.schedule();
  expect(autosave.acknowledgeSaved()).toBe(false);
  autosave.cancel();
  expect(autosave.acknowledgeSaved()).toBe(true);
});

it('distinguishes a typing pause from a slow local save', async () => {
  vi.useFakeTimers();
  const write = Promise.withResolvers<void>();
  const autosave = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftAutosave({
      capture: () => 'draft',
      saveLocalSnapshot: async () => await write.promise,
      persist: vi.fn(async () => {}),
      paused: () => false,
    });
  });
  autosave.schedule();
  await vi.advanceTimersByTimeAsync(500);
  expect(autosave.acknowledgeSaved()).toBe(true);
  expect(autosave.localSaveState()).toBe('saving');
  write.resolve();
  await autosave.settled();
  expect(autosave.localSaveState()).toBe('saved');
});

it('preserves the last edit when navigation disposes the thread supplying its snapshot', async () => {
  vi.useFakeTimers();
  const persist = vi.fn(
    async (_snapshot: { body: string; thread?: string }) => {}
  );
  const saveLocalSnapshot = vi.fn(async () => {});
  const cleaned = vi.fn();
  let body = 'first';
  const root = createRoot((dispose) => {
    disposers.push(dispose);
    const [route, navigate] = createSignal<string>();
    const session = createMemo(() => {
      const id = route();
      if (!id) return;
      onCleanup(cleaned);
      return {
        id,
        autosave: createDraftAutosave({
          capture: () => ({ body, thread: thread() }),
          persist,
          saveLocalSnapshot,
          paused: () => false,
        }),
      };
    });
    const thread = createMemo((): string | undefined => session()?.id);
    return { navigate, session };
  });
  root.navigate('original-thread');
  const autosave = root.session()!.autosave;
  autosave.schedule();
  body = 'last-second edit';
  autosave.schedule();
  await autosave.flushLocal();
  const localWrites = saveLocalSnapshot.mock.calls.length;

  expect(() => root.navigate(undefined)).not.toThrow();
  expect(root.session()).toBeUndefined();
  expect(cleaned).toHaveBeenCalledOnce();
  await autosave.settled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(persist).toHaveBeenCalledExactlyOnceWith({
    body: 'last-second edit',
    thread: 'original-thread',
  });
  expect(saveLocalSnapshot).toHaveBeenCalledTimes(localWrites);
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
