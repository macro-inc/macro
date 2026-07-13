import { describe, expect, it, vi } from 'vitest';
import { loadBlockDataAfterComponentPreload } from './loadBlockData';

describe('loadBlockDataAfterComponentPreload', () => {
  it('starts both operations immediately and waits for component evaluation', async () => {
    let finishPreload: (() => void) | undefined;
    const preload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPreload = resolve;
        })
    );
    const load = vi.fn(async () => 'loaded');

    const result = loadBlockDataAfterComponentPreload(load, preload);
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    expect(preload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishPreload?.();
    await expect(result).resolves.toBe('loaded');
  });

  it('returns normally for an eager component without preload', async () => {
    await expect(
      loadBlockDataAfterComponentPreload(async () => 'loaded')
    ).resolves.toBe('loaded');
  });
});
