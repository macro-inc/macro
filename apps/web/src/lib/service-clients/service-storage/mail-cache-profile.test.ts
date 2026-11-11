import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  platform: 'ios',
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mocks.native,
  invoke: mocks.invoke,
}));
vi.mock('@core/util/platform', () => ({
  getNativeMobilePlatform: () => mocks.platform,
}));

describe('Mail capsule capability', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.native = false;
    mocks.platform = 'ios';
    mocks.invoke.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('uses the current browser engine without native IPC', async () => {
    const { mailCacheProfile } = await import('./mail-cache-profile');
    expect(await mailCacheProfile()).toEqual({
      profile: 'soup-mail-v5',
      outcome: 'browser',
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['ios', 191, 'soup-mail-v2', 'native_unsupported'],
    ['ios', 192, 'soup-mail-v2', 'native_unsupported'],
    ['ios', 193, 'soup-mail-v5', 'native_supported'],
    ['android', 19, 'soup-mail-v2', 'native_unsupported'],
    ['android', 20, 'soup-mail-v5', 'native_supported'],
    ['desktop', 0, 'soup-mail-v2', 'native_unsupported'],
    ['ios', undefined, 'soup-mail-v2', 'native_unsupported'],
  ])(
    'negotiates installed %s build %s as %s',
    async (platform, nativeBuild, profile, outcome) => {
      mocks.native = true;
      mocks.platform = platform;
      mocks.invoke.mockResolvedValue({ nativeBuild });
      const { mailCacheProfile } = await import('./mail-cache-profile');
      expect(await mailCacheProfile()).toEqual({ profile, outcome });
      expect(await mailCacheProfile()).toEqual({ profile, outcome });
      expect(mocks.invoke).toHaveBeenCalledOnce();
    }
  );

  it('keeps old engines compatible when build discovery fails', async () => {
    mocks.native = true;
    mocks.invoke.mockRejectedValue(new Error('unknown command'));
    const { mailCacheProfile } = await import('./mail-cache-profile');
    expect(await mailCacheProfile()).toEqual({
      profile: 'soup-mail-v2',
      outcome: 'native_lookup_failed',
    });
  });

  it('unblocks concurrent callers and keeps the legacy profile after a timeout', async () => {
    vi.useFakeTimers();
    mocks.native = true;
    const pending = Promise.withResolvers<{ nativeBuild: number }>();
    mocks.invoke.mockReturnValue(pending.promise);
    const { mailCacheProfile } = await import('./mail-cache-profile');
    const first = mailCacheProfile();
    const second = mailCacheProfile();

    await vi.advanceTimersByTimeAsync(1500);
    expect(await first).toEqual({
      profile: 'soup-mail-v2',
      outcome: 'native_lookup_timeout',
    });
    expect(await second).toEqual({
      profile: 'soup-mail-v2',
      outcome: 'native_lookup_timeout',
    });

    pending.resolve({ nativeBuild: 193 });
    await pending.promise;
    expect(await mailCacheProfile()).toEqual({
      profile: 'soup-mail-v2',
      outcome: 'native_lookup_timeout',
    });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
