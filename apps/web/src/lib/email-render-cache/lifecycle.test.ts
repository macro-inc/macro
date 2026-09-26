import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateEmailRenders,
  registerEmailRenderInvalidation,
} from './lifecycle';

describe('render session invalidation', () => {
  const releases: (() => void)[] = [];
  afterEach(() => releases.splice(0).forEach((release) => release()));

  it('delivers session end even while an earlier reset is still clearing', async () => {
    const pending = Promise.withResolvers<void>();
    const listener = vi.fn(() => pending.promise);
    releases.push(registerEmailRenderInvalidation(listener));
    const reset = invalidateEmailRenders();
    const logout = invalidateEmailRenders('session-ended');
    expect(listener.mock.calls).toEqual([['reset'], ['session-ended']]);
    let finished = false;
    void logout.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    pending.resolve();
    await Promise.all([reset, logout]);
    expect(finished).toBe(true);
  });

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
