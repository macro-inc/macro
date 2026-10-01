import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoutineAutosave } from './routine-autosave';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let dispose: () => void;
function setup(
  save: (draft: string) => Promise<void>
): ReturnType<typeof createRoutineAutosave<string>> {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return createRoutineAutosave(save);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose();
  vi.useRealTimers();
});

describe('routine autosave', () => {
  it('debounces rapid choices to the latest draft', async () => {
    const save = vi.fn(async () => {});
    const autosave = setup(save);
    autosave.queue('model');
    await vi.advanceTimersByTimeAsync(200);
    autosave.queue('agent');
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.dirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith('agent');
    expect(autosave.dirty()).toBe(false);
  });

  it('never starts an overlapping write and retains only the latest pending edit', async () => {
    const first = deferred();
    const last = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    const autosave = setup(save);
    autosave.queue('first');
    await vi.advanceTimersByTimeAsync(300);
    autosave.queue('second');
    await vi.advanceTimersByTimeAsync(300);
    autosave.queue('last');
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls).toEqual([['first'], ['last']]);
    expect(autosave.dirty()).toBe(true);
    expect(autosave.saving()).toBe(true);
    last.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.dirty()).toBe(false);
  });

  it('does not save a previously valid draft after the latest edit becomes invalid', async () => {
    const save = vi.fn(async () => {});
    const autosave = setup(save);
    autosave.queue('valid');
    autosave.queue(undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.dirty()).toBe(true);
  });

  it('retains failures as unsaved and retries only on request', async () => {
    const failure = new Error('Denied');
    const save = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const autosave = setup(save);
    autosave.queue('agent');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.error()).toBe(failure);
    expect(autosave.dirty()).toBe(true);
    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.error()).toBeUndefined();
    expect(autosave.dirty()).toBe(false);
  });

  it('continues with a newer draft when an older write fails', async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    const autosave = setup(save);
    autosave.queue('old');
    await vi.advanceTimersByTimeAsync(300);
    autosave.queue('new');
    await vi.advanceTimersByTimeAsync(300);
    first.reject(new Error('Old failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls).toEqual([['old'], ['new']]);
    expect(autosave.error()).toBeUndefined();
    expect(autosave.dirty()).toBe(false);
  });

  it.each(['cancel', 'unmount'])(
    'cancels queued work on %s and ignores late failures',
    async (action) => {
      const first = deferred();
      const save = vi.fn(() => first.promise);
      const autosave = setup(save);
      autosave.queue('in flight');
      await vi.advanceTimersByTimeAsync(300);
      autosave.queue('queued');
      if (action === 'cancel') autosave.cancel();
      else dispose();
      first.reject(new Error('Late failure'));
      await vi.advanceTimersByTimeAsync(500);
      expect(save).toHaveBeenCalledTimes(1);
      expect(autosave.error()).toBeUndefined();
      expect(autosave.dirty()).toBe(false);
    }
  );

  it('allows fresh work after cancellation without overlapping the old request', async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    const autosave = setup(save);
    autosave.queue('old');
    await vi.advanceTimersByTimeAsync(300);
    autosave.cancel();
    autosave.queue('fresh');
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save.mock.calls).toEqual([['old'], ['fresh']]);
    expect(autosave.dirty()).toBe(false);
  });
});
