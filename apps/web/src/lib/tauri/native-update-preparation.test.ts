import { describe, expect, it, vi } from 'vitest';
import { createNativeUpdatePreparation } from './native-update-preparation';

describe('native restart preparation', () => {
  it('awaits pending editor saves before flushing local persistence', async () => {
    let finishSave!: () => void;
    const saved = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const flush = vi.fn(async () => {});
    const preparation = createNativeUpdatePreparation({
      isBlocked: () => false,
      flush,
    });
    preparation.register(() => saved);
    let ready = false;
    const result = preparation.prepare().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();
    expect(ready).toBe(false);
    finishSave();
    await result;
    expect(flush).toHaveBeenCalledOnce();
    expect(ready).toBe(true);
  });

  it('rejects active calls without running saves or unload side effects', async () => {
    const flush = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    const preparation = createNativeUpdatePreparation({
      isBlocked: () => true,
      flush,
    });
    preparation.register(save);
    const disconnectCall = vi.fn();
    window.addEventListener('beforeunload', disconnectCall);
    try {
      await expect(preparation.prepare()).rejects.toThrow('Finish your call');
      expect(save).not.toHaveBeenCalled();
      expect(flush).not.toHaveBeenCalled();
      expect(disconnectCall).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('beforeunload', disconnectCall);
    }
  });

  it('does not restart after a failed editor save and unregisters closed editors', async () => {
    const preparation = createNativeUpdatePreparation({
      isBlocked: () => false,
      flush: async () => {},
    });
    const unregister = preparation.register(async () => {
      throw new Error('save failed');
    });
    await expect(preparation.prepare()).rejects.toThrow('save failed');
    unregister();
    await expect(preparation.prepare()).resolves.toBeUndefined();
  });
});
