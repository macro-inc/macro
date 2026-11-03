// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ChannelCallTab } from '../ChannelCallTab';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  leave: async (): Promise<{ callEnded: boolean }> => ({ callEnded: false }),
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => state.navigate,
  useLocation: () => ({ key: 'channel-route' }),
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

it.each([{ callEnded: true }, { callEnded: false }])(
  'stays in the channel after hangup (callEnded=$callEnded)',
  async (test) => {
    const [inCallTab, setInCallTab] = createSignal(true);
    let leaving: Promise<{ callEnded: boolean }> | undefined;
    state.leave = () => {
      setInCallTab(false);
      leaving = Promise.resolve({ callEnded: test.callEnded });
      return leaving;
    };
    render(() => (
      <Show when={inCallTab()} fallback={<p>Channel messages</p>}>
        <ChannelCallTab channelId="channel-1" />
      </Show>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    await leaving;
    await Promise.resolve();
    expect(screen.getByText('Channel messages')).toBeTruthy();
    expect(state.navigate).not.toHaveBeenCalled();
  }
);
