import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  resolvedSession: vi.fn(async () => 'signed-in'),
}));

vi.mock('./session', () => session);

beforeEach(() => {
  vi.resetModules();
  session.resolvedSession.mockResolvedValue('signed-in');
});

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
      await vi.advanceTimersByTimeAsync(0);
      await lifecycle.unregisterPushRegistrationsForLogout();
      await vi.runAllTimersAsync();
      await syncing;
      expect(syncRegistration).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not register a device without a signed-in session', async () => {
    session.resolvedSession.mockResolvedValue('signed-out');
    const lifecycle = await import('./push-registration-lifecycle');
    const syncRegistration = vi.fn(async () => {});
    lifecycle.registerPushRegistrationLifecycle({
      syncRegistration,
      unregisterForLogout: async () => {},
    });
    await lifecycle.syncPushRegistrations('resume');
    await lifecycle.syncPushRegistrations();
    expect(syncRegistration).not.toHaveBeenCalled();
  });
});
