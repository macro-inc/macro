import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveCallCompanion } from '../primitives/use-active-call-companion';

const state = vi.hoisted(() => ({
  joining: false,
  attrs: {} as Record<string, unknown>,
  spans: [] as string[],
  disconnect: vi.fn(async () => {}),
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/app' }),
}));
vi.mock('@app/observability/flow', () => ({
  beginInteraction: () => ({ end: () => {} }),
}));
vi.mock('@app/signal/splitLayout', () => ({ globalSplitManager: () => null }));
vi.mock('../open-channel-call-tab', () => ({ openChannelCallTab: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: async (
      name: string,
      run: (span: { setAttr: (key: string, value: unknown) => void }) => unknown
    ) => {
      state.spans.push(name);
      return run({
        setAttr: (key, value) => {
          state.attrs[key] = value;
        },
      });
    },
  },
}));
vi.mock('../CallContext', () => ({
  useCallContextOptional: () => ({
    activeCallId: () => 'call-1',
    activeChannelId: () => null,
    isInCall: () => true,
    isCallPage: () => false,
    callLifecycle: { getState: () => ({ t: 'idle' }), leave: vi.fn() },
    meetingSession: { disconnect: state.disconnect },
  }),
}));
vi.mock('@app/features/meetings/context/meeting-session-owner', () => ({
  useMeetingSessionOwnerOptional: () => ({
    forCall: () => undefined,
    isJoining: (callId: string) => state.joining && callId === 'call-1',
  }),
}));
vi.mock('../native-call-state', () => ({
  useMaybeNativeCallState: () => ({ activeChannelId: () => 'meeting:call-1' }),
}));

beforeEach(() => {
  state.joining = false;
  state.attrs = {};
  state.spans = [];
  state.disconnect.mockClear();
});

describe('a native meeting call with no meeting page', () => {
  it('leaves it under the call.leave span once the web view lost its session', async () => {
    const companion = createRoot(() => useActiveCallCompanion());
    expect(companion.canLeave()).toBe(true);
    await companion.leave();
    expect(state.disconnect).toHaveBeenCalledOnce();
    expect(state.spans).toEqual(['call.leave']);
    expect(state.attrs).toMatchObject({
      'call.id': 'call-1',
      'call.leave.orphaned': true,
    });
  });

  it('is not orphaned while its meeting is still joining', async () => {
    state.joining = true;
    const companion = createRoot(() => useActiveCallCompanion());
    expect(companion.canLeave()).toBe(false);
    await companion.leave();
    expect(state.disconnect).not.toHaveBeenCalled();
  });
});
