import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallKitSetup } from '../use-callkit';

const bridge = vi.hoisted(() => ({
  watchers: new Map<string, (payload: unknown) => void>(),
  pending: null as { channelId: string; nativeMedia: boolean } | null,
  cleanups: [] as (() => void)[],
  open: vi.fn(async () => {}),
  join: vi.fn(async () => {}),
}));
vi.mock('solid-js', async (original) => ({
  ...(await original<typeof import('solid-js')>()),
  onMount: (callback: () => void) => callback(),
  onCleanup: (callback: () => void) => bridge.cleanups.push(callback),
}));
vi.mock('@app/signal/splitLayout', () => ({
  whenSplitManagerReady: async () => {},
}));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  registerPushRegistrationLifecycle: () => () => {},
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => true,
  isPlatform: (platform: string) => platform === 'android',
}));
vi.mock('@queries/auth', () => ({ useUserNamesQuery: vi.fn() }));
vi.mock('@queries/call/call', () => ({
  invalidateActiveCallQueries: async () => {},
}));
vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {},
}));
vi.mock('../join-channel-call', () => ({ joinChannelCall: bridge.join }));
vi.mock('../open-channel-call-tab', () => ({
  openChannelCallTab: bridge.open,
}));
vi.mock('../use-callkit-theme-sync', () => ({ useCallKitThemeSync: vi.fn() }));
vi.mock('../native-call-state', () => ({
  useNativeCallState: () => ({
    setBootstrapChannelId: vi.fn(),
    setParticipantIdentities: vi.fn(),
    setSnapshot: vi.fn(),
    snapshot: () => null,
    bootstrapChannelId: () => null,
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    constructor(readonly receive: (payload: unknown) => void) {}
  },
  addPluginListener: vi.fn(),
  invoke: async (
    command: string,
    args?: { channel: { receive: (payload: unknown) => void } }
  ) => {
    if (args?.channel) bridge.watchers.set(command, args.channel.receive);
    if (command.endsWith('|get_pending_answered_call')) {
      const answer = bridge.pending;
      bridge.pending = null;
      return answer ?? { channelId: null, nativeMedia: true };
    }
    return { state: null };
  },
}));

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
function answer(channelId = 'channel-1', nativeMedia = true) {
  const payload = { channelId, nativeMedia };
  bridge.pending = payload;
  bridge.watchers.get('plugin:call-kit|watch_call_answered')!(payload);
}
function resume() {
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  bridge.pending = null;
  bridge.watchers.clear();
  bridge.open.mockClear();
  bridge.join.mockClear();
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { visibilityState: 'visible' })
  );
});
afterEach(() => {
  bridge.cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native answered-call recovery', () => {
  it.each([true, false])(
    'consumes a live answer with nativeMedia=%s before a later resume',
    async (nativeMedia) => {
      useCallKitSetup();
      await settle();
      answer('channel-1', nativeMedia);
      await settle();
      const navigation = nativeMedia ? bridge.open : bridge.join;
      expect(navigation).toHaveBeenCalledExactlyOnceWith('channel-1');
      expect(bridge.pending).toBeNull();
      await vi.advanceTimersByTimeAsync(3000);
      resume();
      await settle();
      expect(navigation).toHaveBeenCalledOnce();
    }
  );

  it('recovers a cold-start answer and a subsequent answer missed while suspended', async () => {
    bridge.pending = { channelId: 'channel-1', nativeMedia: true };
    useCallKitSetup();
    await settle();
    expect(bridge.open).toHaveBeenCalledExactlyOnceWith('channel-1');
    await vi.advanceTimersByTimeAsync(3000);
    bridge.pending = { channelId: 'channel-2', nativeMedia: true };
    resume();
    await settle();
    expect(bridge.open).toHaveBeenCalledTimes(2);
    expect(bridge.open).toHaveBeenLastCalledWith('channel-2');
  });

  it('allows a new call in the same channel after the previous call ends', async () => {
    useCallKitSetup();
    await settle();
    answer();
    await settle();
    bridge.watchers.get('plugin:call-kit|watch_call_ended')!({
      callId: 'call-1',
    });
    answer();
    await settle();
    expect(bridge.open).toHaveBeenCalledTimes(2);
    expect(bridge.pending).toBeNull();
  });
});
