import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateEmailRenders,
  registerEmailRenderInvalidation,
} from './lifecycle';

describe('render session invalidation', () => {
  const releases: (() => void)[] = [];
  afterEach(() => releases.splice(0).forEach((release) => release()));

  it('still invalidates remaining owners when storage fails and releases registrations', async () => {
    releases.push(
      registerEmailRenderInvalidation(async () => {
        throw new Error('storage unavailable');
      })
    );
    const listener = vi.fn(async () => {});
    const release = registerEmailRenderInvalidation(listener);
    releases.push(release);
    await expect(
      invalidateEmailRenders('session-ended')
    ).resolves.toBeUndefined();
    expect(listener).toHaveBeenCalledWith('session-ended');
    release();
    await invalidateEmailRenders();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
