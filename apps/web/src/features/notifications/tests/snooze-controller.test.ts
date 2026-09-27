import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSnoozeController } from '../primitives/create-snooze-controller';

describe('snoozing notifications', () => {
  it('rejects expired and invalid selections without sending a request', async () => {
    const save = vi.fn();
    const controller = createRoot(() =>
      createSnoozeController({
        items: ['one'],
        saveItem: save,
        onSaved: vi.fn(),
        now: () => 1000,
      })
    );
    await controller.submit(new Date(1000));
    await controller.submit(new Date('invalid'));
    expect(save).not.toHaveBeenCalled();
    expect(controller.error()).toBe('Choose a time in the future.');
  });

  it('keeps a failed write retryable and closes only after persistence succeeds', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onSaved = vi.fn();
    const controller = createRoot(() =>
      createSnoozeController({
        items: ['one'],
        saveItem: save,
        onSaved,
        now: () => 0,
      })
    );
    await controller.submit(new Date(1000));
    expect(onSaved).not.toHaveBeenCalled();
    expect(controller.error()).toBeTruthy();
    expect(controller.pending()).toBe(false);
    await controller.submit(new Date(1000));
    expect(onSaved).toHaveBeenCalledWith('1970-01-01T00:00:01.000Z', 1);
    expect(controller.error()).toBeUndefined();
  });

  it('ignores repeated submissions while a write is pending', async () => {
    let finish!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const controller = createRoot(() =>
      createSnoozeController({
        items: ['one'],
        saveItem: save,
        onSaved: vi.fn(),
        now: () => 0,
      })
    );
    const first = controller.submit(new Date(1000));
    await controller.submit(new Date(2000));
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(controller.pending()).toBe(false);
  });

  it('reports partial success and retries only unsaved items at the new deadline', async () => {
    const saved = new Map<string, string>();
    const saveItem = vi.fn(async (item: string, until: string) => {
      if (item === 'two' && until === '1970-01-01T00:00:01.000Z') {
        throw new Error('offline');
      }
      saved.set(item, until);
    });
    const onSaved = vi.fn();
    const controller = createRoot(() =>
      createSnoozeController({
        items: ['one', 'two'],
        saveItem,
        onSaved,
        now: () => 0,
      })
    );
    await controller.submit(new Date(1000));
    expect(onSaved).not.toHaveBeenCalled();
    expect(controller.remainingCount()).toBe(1);
    expect(controller.error()).toBe(
      '1 of 2 items snoozed. Choose a time to retry the 1 remaining. Closing keeps saved snoozes.'
    );
    expect(saved.size).toBe(1);

    await controller.submit(new Date(2000));
    expect(saveItem).toHaveBeenCalledTimes(3);
    expect(saved.get('one')).toBe('1970-01-01T00:00:01.000Z');
    expect(saved.get('two')).toBe('1970-01-01T00:00:02.000Z');
    expect(controller.error()).toBeUndefined();
    expect(controller.remainingCount()).toBe(0);
    expect(onSaved).toHaveBeenCalledWith('1970-01-01T00:00:02.000Z', 1);
    await controller.submit(new Date(3000));
    expect(saveItem).toHaveBeenCalledTimes(3);
  });
});
