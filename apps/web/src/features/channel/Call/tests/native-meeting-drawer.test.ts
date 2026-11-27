import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNativeMeetingOpener, useCallKitSetup } from '../use-callkit';

const bridge = vi.hoisted(() => ({
  watchers: new Map<string, (payload: unknown) => void>(),
  pending: null as {
    channelId: string;
    nativeMedia: boolean;
    callId?: string;
    answeredAtMs?: number;
  } | null,
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
vi.mock('@tauri-apps/plugin-os', () => ({ version: () => '16' }));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => true,
  isPlatform: (platform: string) => platform === 'ios',
}));
vi.mock('@queries/auth', () => ({ useUserNames: vi.fn() }));
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
  addPluginListener: async () => ({ unregister: async () => {} }),
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

beforeEach(() => {
  vi.useFakeTimers();
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

async function openDrawer(channelId: string) {
  bridge.watchers.get('plugin:call-kit|watch_drawer_opened')!({ channelId });
  await vi.advanceTimersByTimeAsync(0);
}

describe('opening the native call screen', () => {
  it('returns a meeting call to its meeting, not a channel', async () => {
    useCallKitSetup();
    await vi.advanceTimersByTimeAsync(0);
    const otherMeeting = vi.fn(() => false);
    const meeting = vi.fn(
      (callId: string) => callId === '01a1f517-3048-7a99-afa9-5de4b147bf2f'
    );
    bridge.cleanups.push(registerNativeMeetingOpener(meeting));
    bridge.cleanups.push(registerNativeMeetingOpener(otherMeeting));

    await openDrawer('meeting:01a1f517-3048-7a99-afa9-5de4b147bf2f');

    expect(otherMeeting).toHaveBeenCalledOnce();
    expect(meeting).toHaveBeenCalledExactlyOnceWith(
      '01a1f517-3048-7a99-afa9-5de4b147bf2f'
    );
    expect(bridge.open).not.toHaveBeenCalled();
    expect(bridge.join).not.toHaveBeenCalled();
  });

  it('still opens a channel call in its channel', async () => {
    useCallKitSetup();
    await vi.advanceTimersByTimeAsync(0);
    const meeting = vi.fn(() => true);
    bridge.cleanups.push(registerNativeMeetingOpener(meeting));

    await openDrawer('channel-1');

    expect(bridge.open).toHaveBeenCalledExactlyOnceWith('channel-1');
    expect(meeting).not.toHaveBeenCalled();
  });
});
