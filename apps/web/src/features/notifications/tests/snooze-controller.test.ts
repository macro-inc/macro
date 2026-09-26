import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createSnoozeController } from '../primitives/create-snooze-controller';

describe('snoozing notifications', () => {
  it('rejects expired and invalid selections without sending a request', async () => {
    const save = vi.fn();
    const controller = createRoot(() =>
      createSnoozeController({ save, onSaved: vi.fn(), now: () => 1000 })
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
      createSnoozeController({ save, onSaved, now: () => 0 })
    );
    await controller.submit(new Date(1000));
    expect(onSaved).not.toHaveBeenCalled();
    expect(controller.error()).toBeTruthy();
    expect(controller.pending()).toBe(false);
    await controller.submit(new Date(1000));
    expect(onSaved).toHaveBeenCalledWith('1970-01-01T00:00:01.000Z');
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
      createSnoozeController({ save, onSaved: vi.fn(), now: () => 0 })
    );
    const first = controller.submit(new Date(1000));
    await controller.submit(new Date(2000));
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(controller.pending()).toBe(false);
  });
});
