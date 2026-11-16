import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendarComposerSession } from './create-calendar-composer-session';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('calendar composer sessions', () => {
  it('keeps the editor identity and close guard while pinning', async () => {
    const confirmDiscard = vi.fn().mockResolvedValue(true);
    const source = createRoot((dispose) => {
      disposers.push(dispose);
      return createCalendarComposerSession({ confirmDiscard });
    });
    const key = await source.open({});
    if (key === undefined) throw new Error('Session did not open');
    const original = source.state.session;
    source.setDirty(key, true);
    source.setPinned(key, true);
    expect(source.state.session).toBe(original);
    expect(source.hasUnsavedChanges()).toBe(true);
    source.setPinned(key, false);
    expect(source.state.session).toBe(original);
    source.markSaved(key);
    expect(await source.close(key)).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('does not replace a dirty draft until discarding is approved', async () => {
    const confirmDiscard = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    const source = createRoot((dispose) => {
      disposers.push(dispose);
      return createCalendarComposerSession({ confirmDiscard });
    });
    const first = await source.open({ onClose });
    if (first === undefined) throw new Error('Session did not open');
    source.setDirty(first, true);
    source.setPinned(first, true);
    expect(await source.open({})).toBeUndefined();
    expect(source.state.session?.key).toBe(first);
    expect(source.state.pinned).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    confirmDiscard.mockResolvedValue(true);
    const second = await source.open({});
    expect(second).not.toBe(first);
    expect(source.state.session?.key).toBe(second);
    expect(source.state.pinned).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('rejects late callbacks from a replaced session', async () => {
    const confirmDiscard = vi.fn().mockResolvedValue(true);
    const source = createRoot((dispose) => {
      disposers.push(dispose);
      return createCalendarComposerSession({ confirmDiscard });
    });
    const first = await source.open({});
    const second = await source.open({});
    if (first === undefined || second === undefined)
      throw new Error('Session did not open');
    source.setDirty(second, true);
    source.markSaved(first);
    source.setDirty(first, false);
    source.setPinned(first, true);
    expect(await source.close(first)).toBe(false);
    expect(source.state.session?.key).toBe(second);
    expect(source.state.pinned).toBe(false);
    expect(source.hasUnsavedChanges()).toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('does not commit a dismissal after its owner is disposed', async () => {
    const confirmation = Promise.withResolvers<boolean>();
    const onClose = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createCalendarComposerSession({
        confirmDiscard: () => confirmation.promise,
      }),
      dispose,
    }));
    disposers.push(dispose);
    const key = await source.open({ onClose });
    if (key === undefined) throw new Error('Session did not open');
    source.setDirty(key, true);
    const closing = source.close(key);
    expect(await source.open({})).toBeUndefined();
    dispose();
    confirmation.resolve(true);
    expect(await closing).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps failed confirmation retryable without losing the draft', async () => {
    const confirmDiscard = vi
      .fn()
      .mockRejectedValueOnce(new Error('Confirmation failed'))
      .mockResolvedValue(true);
    const source = createRoot((dispose) => {
      disposers.push(dispose);
      return createCalendarComposerSession({ confirmDiscard });
    });
    const key = await source.open({});
    if (key === undefined) throw new Error('Session did not open');
    source.setDirty(key, true);
    await expect(source.close(key)).rejects.toThrow('Confirmation failed');
    expect(source.state.session?.key).toBe(key);
    expect(source.state.transitioning).toBe(false);
    expect(await source.close(key)).toBe(true);
  });
});
