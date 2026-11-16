import { describe, expect, it, vi } from 'vitest';
import { createEventComposerCloseGuard } from './create-event-composer-close-guard';

describe('event composer close guard', () => {
  it('closes a clean form once and calls cleanup before closing', async () => {
    const order: string[] = [];
    const confirmDiscard = vi.fn();
    const guard = createEventComposerCloseGuard({
      confirmDiscard,
      onBeforeClose: () => order.push('cleanup'),
    });
    expect(await guard.requestClose(() => order.push('close'))).toBe(true);
    expect(await guard.requestClose(() => order.push('duplicate'))).toBe(false);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(order).toEqual(['cleanup', 'close']);
  });

  it('keeps dirty edits when discard is declined, then allows another decision', async () => {
    const confirmDiscard = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const close = vi.fn();
    const guard = createEventComposerCloseGuard({ confirmDiscard });
    guard.setDirty(true);
    expect(await guard.requestClose(close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(await guard.requestClose(close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes a saved dirty form without a discard prompt', async () => {
    const confirmDiscard = vi.fn();
    const guard = createEventComposerCloseGuard({ confirmDiscard });
    guard.setDirty(true);
    guard.markSaved();
    expect(await guard.requestClose(vi.fn())).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('does not duplicate a pending confirmation or close a disposed session', async () => {
    const decision = Promise.withResolvers<boolean>();
    const confirmDiscard = vi.fn(() => decision.promise);
    const close = vi.fn();
    const guard = createEventComposerCloseGuard({ confirmDiscard });
    guard.setDirty(true);
    const pendingClose = guard.requestClose(close);
    expect(await guard.requestClose(close)).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    guard.dispose();
    decision.resolve(true);
    expect(await pendingClose).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('allows another decision after a failed confirmation', async () => {
    const confirmDiscard = vi
      .fn()
      .mockRejectedValueOnce(new Error('Confirmation unavailable'))
      .mockResolvedValueOnce(true);
    const guard = createEventComposerCloseGuard({ confirmDiscard });
    guard.setDirty(true);
    await expect(guard.requestClose(vi.fn())).rejects.toThrow(
      'Confirmation unavailable'
    );
    expect(await guard.requestClose(vi.fn())).toBe(true);
  });

  it('keeps a failed close retryable', async () => {
    const onBeforeClose = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Cleanup failed');
      })
      .mockImplementation(() => {});
    const close = vi.fn();
    const guard = createEventComposerCloseGuard({
      confirmDiscard: vi.fn(),
      onBeforeClose,
    });
    await expect(guard.requestClose(close)).rejects.toThrow('Cleanup failed');
    expect(close).not.toHaveBeenCalled();
    expect(await guard.requestClose(close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps an approved navigation separate from actually closing the form', async () => {
    const onBeforeClose = vi.fn();
    const confirmDiscard = vi.fn().mockResolvedValue(true);
    const guard = createEventComposerCloseGuard({
      confirmDiscard,
      onBeforeClose,
    });
    guard.setDirty(true);
    expect(await guard.confirmClose()).toBe(true);
    expect(guard.needsConfirmation()).toBe(true);
    expect(onBeforeClose).not.toHaveBeenCalled();

    // A cancelled navigation keeps the form and still guards the next attempt.
    expect(await guard.confirmClose()).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
    const close = vi.fn();
    expect(guard.completeClose(close)).toBe(true);
    expect(guard.needsConfirmation()).toBe(false);
    expect(onBeforeClose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
