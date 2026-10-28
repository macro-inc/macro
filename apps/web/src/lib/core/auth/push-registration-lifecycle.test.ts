import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('push registration session boundary', () => {
  it('ignores resume events during logout until a new session is established', async () => {
    const lifecycle = await import('./push-registration-lifecycle');
    let finishLogout!: () => void;
    const syncRegistration = vi.fn(async () => {});
    lifecycle.registerPushRegistrationLifecycle({
      syncRegistration,
      unregisterForLogout: () =>
        new Promise<void>((resolve) => {
          finishLogout = resolve;
        }),
    });
    const logout = lifecycle.unregisterPushRegistrationsForLogout();
    await lifecycle.syncPushRegistrations('resume');
    expect(syncRegistration).not.toHaveBeenCalled();
    finishLogout();
    await logout;
    await lifecycle.syncPushRegistrations('resume');
    expect(syncRegistration).not.toHaveBeenCalled();
    await lifecycle.syncPushRegistrations();
    expect(syncRegistration).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed registration from the previous session', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lifecycle = await import('./push-registration-lifecycle');
      const syncRegistration = vi.fn(async () => {
        throw new Error('offline');
      });
      lifecycle.registerPushRegistrationLifecycle({
        syncRegistration,
        unregisterForLogout: async () => {},
      });
      const syncing = lifecycle.syncPushRegistrations();
      await Promise.resolve();
      await lifecycle.unregisterPushRegistrationsForLogout();
      await vi.runAllTimersAsync();
      await syncing;
      expect(syncRegistration).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});
