// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelCallTab } from '../ChannelCallTab';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  key: 'channel-route',
  leave: async (): Promise<{ callEnded: boolean }> => ({ callEnded: false }),
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => state.navigate,
  useLocation: () => ({
    get key() {
      return state.key;
    },
  }),
}));
vi.mock('@channel/Channel/ChannelTabContext', () => ({
  useChannelTab: () => ({ setActiveTab: () => {} }),
}));
vi.mock('../use-call', () => ({
  useCall: () => ({
    leaveCall: () => state.leave(),
    isInThisChannel: () => true,
    joinError: () => null,
    callCtx: { activeCallId: () => 'call-1', isInCall: () => false },
  }),
}));
vi.mock('../ActiveCallLink', () => ({ ActiveCallLink: () => null }));
vi.mock('../CallOverlay', () => ({
  CallOverlay: (props: { onLeave: () => Promise<void> }) => (
    <button type="button" onClick={props.onLeave}>
      Leave call
    </button>
  ),
}));
vi.mock('@queries/call/call', () => ({}));
vi.mock('@core/component/UserGroup', () => ({}));
vi.mock('@core/user', () => ({}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  { callEnded: true, navigateAway: false, destination: '/calls/call/call-1' },
  { callEnded: false, navigateAway: false, destination: undefined },
  { callEnded: true, navigateAway: true, destination: undefined },
])(
  'handles hangup after the call tab unmounts: $callEnded, moved=$navigateAway',
  async (test) => {
    state.key = 'channel-route';
    const [inCallTab, setInCallTab] = createSignal(true);
    let finish!: (result: { callEnded: boolean }) => void;
    const response = new Promise<{ callEnded: boolean }>((resolve) => {
      finish = resolve;
    });
    let leaving: Promise<{ callEnded: boolean }> | undefined;
    state.leave = () => {
      setInCallTab(false);
      leaving = response;
      return response;
    };
    render(() => (
      <Show when={inCallTab()} fallback={<p>Channel messages</p>}>
        <ChannelCallTab channelId="channel-1" />
      </Show>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(screen.getByText('Channel messages')).toBeTruthy();
    if (test.navigateAway) state.key = 'another-route';
    finish({ callEnded: test.callEnded });
    await leaving;
    if (test.destination)
      await waitFor(() =>
        expect(state.navigate).toHaveBeenCalledExactlyOnceWith(test.destination)
      );
    else expect(state.navigate).not.toHaveBeenCalled();
  }
);
