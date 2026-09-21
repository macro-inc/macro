import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForDatabaseRollout } from './database-rollout';

const state = vi.hoisted(() => ({
  override: undefined as boolean | undefined,
  current: undefined as boolean | undefined,
  callback: undefined as
    | undefined
    | ((
        _flags: string[],
        _variants: Record<string, boolean>,
        context?: { errorsLoading?: boolean }
      ) => void),
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableDatabases: {
    key: 'enable-databases',
    get override() {
      return state.override;
    },
  },
}));
vi.mock('@app/lib/analytics', () => ({
  analytics: {
    posthog: {
      isFeatureEnabled: () => state.current,
      onFeatureFlags: state.subscribe,
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  state.override = undefined;
  state.current = undefined;
  state.callback = undefined;
  state.unsubscribe.mockReset();
  state.subscribe.mockReset().mockImplementation((callback) => {
    state.callback = callback;
    return state.unsubscribe;
  });
});
afterEach(() => vi.useRealTimers());

describe('database deep-link rollout readiness', () => {
  it.each([true, false])(
    'uses an explicit %s override without waiting on PostHog',
    async (enabled) => {
      state.override = enabled;
      expect(await waitForDatabaseRollout()).toBe(enabled);
      expect(state.subscribe).not.toHaveBeenCalled();
    }
  );
  it.each([true, false])(
    'waits for the remote %s decision instead of prematurely rejecting a fresh link',
    async (enabled) => {
      const resolved = vi.fn();
      const result = waitForDatabaseRollout().then(resolved);
      await Promise.resolve();
      expect(resolved).not.toHaveBeenCalled();
      state.current = enabled;
      state.callback?.([], {});
      await result;
      expect(resolved).toHaveBeenCalledExactlyOnceWith(enabled);
      expect(state.unsubscribe).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it('fails closed when remote flags cannot be loaded', async () => {
    const result = waitForDatabaseRollout();
    state.current = true;
    state.callback?.([], {}, { errorsLoading: true });
    expect(await result).toBe(false);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });
  it('does not hang navigation if a blocked PostHog request never calls back', async () => {
    const result = waitForDatabaseRollout();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(false);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up when PostHog invokes its readiness callback synchronously', async () => {
    state.subscribe.mockImplementation((callback) => {
      state.current = true;
      callback([], {});
      return state.unsubscribe;
    });
    expect(await waitForDatabaseRollout()).toBe(true);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
