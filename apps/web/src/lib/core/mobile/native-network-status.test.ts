import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  receive: undefined as ((payload: { status: string }) => void) | undefined,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platforms: string | string[]) => platforms.includes('android'),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: class {
    constructor(receive: typeof mocks.receive) {
      mocks.receive = receive;
    }
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Android native reachability', () => {
  it('starts the bridge and aborts offline work, then gives reconnect work a fresh signal', async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const network = await import('./native-network-status');
    const observed: string[] = [];
    const unsubscribe = network.subscribeNativeNetworkStatus((status) =>
      observed.push(status)
    );
    await network.initializeNativeNetworkStatus();
    expect(mocks.invoke).toHaveBeenCalledWith(
      'plugin:network-status|watch_status',
      expect.objectContaining({ channel: expect.anything() })
    );
    const initial = network.getNativeNetworkAbortSignal();
    mocks.receive?.({ status: 'offline' });
    expect(initial.aborted).toBe(true);
    mocks.receive?.({ status: 'online' });
    expect(network.getNativeNetworkAbortSignal().aborted).toBe(false);
    expect(network.getNativeNetworkAbortSignal()).not.toBe(initial);
    expect(observed).toEqual(['unknown', 'offline', 'online']);
    unsubscribe();
  });

  it('leaves older Android binaries on browser connectivity when the command is absent', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.invoke.mockRejectedValue(new Error('unknown command'));
    const network = await import('./native-network-status');
    const initialized = network.initializeNativeNetworkStatus();
    await vi.runAllTimersAsync();
    await initialized;
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(network.nativeNetworkStatus()).toBe('unknown');
    expect(network.getNativeNetworkAbortSignal().aborted).toBe(false);
    vi.restoreAllMocks();
  });
});
