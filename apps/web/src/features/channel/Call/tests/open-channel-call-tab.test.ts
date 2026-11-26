import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openChannelCallTab } from '../open-channel-call-tab';

const state = vi.hoisted(() => ({
  native: false,
  ios: false,
  existing: true,
  tab: 'messages',
  overlay: 'minimized',
  activate: vi.fn(),
  open: vi.fn(),
  getHandle: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: () =>
      state.existing ? { activate: state.activate } : undefined,
    openWithSplit: state.open,
    getOrchestrator: () => ({ getBlockHandle: state.getHandle }),
  }),
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => state.native,
  isPlatform: (platform: string) => platform === 'ios' && state.ios,
}));
vi.mock('../use-callkit', () => ({
  isNativeCallEnabled: () => state.native,
  setNativeCallKitVideoOverlayMode: async (mode: string) => {
    state.overlay = mode;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.native = false;
  state.ios = false;
  state.existing = true;
  state.tab = 'messages';
  state.overlay = 'minimized';
  state.getHandle.mockResolvedValue({
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      if (params.open_call_tab === 'true') state.tab = 'call';
    },
  });
});

describe('return to the channel call', () => {
  it.each(['messages', 'attachments', 'calls', 'participants'])(
    'opens the call from the already-open %s tab without rejoining',
    async (tab) => {
      state.tab = tab;
      await openChannelCallTab('channel-id');
      expect(state.activate).toHaveBeenCalledOnce();
      expect(state.open).not.toHaveBeenCalled();
      expect(state.tab).toBe('call');
    }
  );

  it('opens a channel before selecting its call tab', async () => {
    state.existing = false;
    await openChannelCallTab('channel-id');
    expect(state.open).toHaveBeenCalledWith(
      { type: 'channel', id: 'channel-id' },
      { activate: true, referredFrom: 'sidebar' }
    );
    expect(state.tab).toBe('call');
  });

  it.each(['ios', 'android'])(
    'expands the native %s call even on its already-open channel',
    async (platform) => {
      state.native = true;
      state.ios = platform === 'ios';
      await openChannelCallTab('channel-id');
      expect(state.overlay).toBe('expanded');
      expect(state.tab).toBe('messages');
      expect(state.getHandle).not.toHaveBeenCalled();
    }
  );
});
