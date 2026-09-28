import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallAgain } from './use-call-again';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  joinChannelCall: vi.fn(),
  state: { enabled: true, shareToken: undefined as string | undefined },
}));

vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@channel/Call/join-channel-call', () => ({
  joinChannelCall: mocks.joinChannelCall,
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => ({
    loading: false,
    enabled: mocks.state.enabled,
  }),
}));
vi.mock('@queries/call/meetings', () => ({
  useCallLinkQuery: (callId: () => string | undefined) => ({
    get isSuccess() {
      return Boolean(callId() && mocks.state.shareToken);
    },
    get data() {
      return mocks.state.shareToken
        ? { shareToken: mocks.state.shareToken }
        : undefined;
    },
  }),
}));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.joinChannelCall.mockReset();
  mocks.state.enabled = true;
  mocks.state.shareToken = undefined;
});

describe('useCallAgain', () => {
  it('rejoins a channel call without opening a meeting link', () => {
    createRoot((dispose) => {
      const { canCallAgain, callAgain } = useCallAgain(
        () => 'call-id',
        () => 'channel-id'
      );
      expect(canCallAgain()).toBe(true);
      callAgain();
      expect(mocks.joinChannelCall).toHaveBeenCalledWith('channel-id');
      expect(mocks.navigate).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('opens a standalone meeting invitation when quick calls are enabled', () => {
    mocks.state.shareToken = 'invite-token';
    createRoot((dispose) => {
      const { canCallAgain, callAgain } = useCallAgain(
        () => 'call-id',
        () => null
      );
      expect(canCallAgain()).toBe(true);
      callAgain();
      expect(mocks.navigate).toHaveBeenCalledWith('/meet/join/invite-token');
      expect(mocks.joinChannelCall).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('hides standalone rejoin when quick calls are disabled', () => {
    mocks.state.shareToken = 'invite-token';
    mocks.state.enabled = false;
    createRoot((dispose) => {
      const { canCallAgain, callAgain } = useCallAgain(
        () => 'call-id',
        () => undefined
      );
      expect(canCallAgain()).toBe(false);
      callAgain();
      expect(mocks.navigate).not.toHaveBeenCalled();
      dispose();
    });
  });
});
