/** @vitest-environment jsdom */
import { ChannelTabProvider } from '@channel/Channel/ChannelTabContext';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { queryClient } from '@queries/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPreviewCallState } from '../../../meetings/debug/preview-call-state';
import type { CallState } from '../CallContext';
import { ChannelCallTab } from '../ChannelCallTab';

const mocks = vi.hoisted(() => ({
  call: undefined as CallState | undefined,
  leaveCall: vi.fn(),
  getCallLink: vi.fn(),
  checkActiveCall: vi.fn(),
  getCallRecord: vi.fn(),
}));

vi.mock('@service-call/client', () => ({ callServiceClient: mocks }));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: () => {},
  createConnectionBlockWebsocketEffect: () => {},
  ws: {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
  },
  state: () => 'closed',
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@app/lib/analytics', () => ({ analytics: { track: () => {} } }));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContext: () => mocks.call,
  BACKGROUND_IMAGES: [],
}));
vi.mock('@core/context/user', () => ({
  useAuthor: () => () => 'Call owner',
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channelsById: () => ({}) }),
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>Avatar</span>,
}));
vi.mock('@core/component/UserGroup', () => ({
  UserGroup: () => <span>Participants</span>,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('../use-callkit', () => ({
  isNativeIosCallKitEnabled: () => false,
  registerCallKitCallEndedHandler: () => () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.leaveCall.mockResolvedValue(ok(undefined));
  mocks.getCallLink.mockResolvedValue(ok({ shareToken: 'meeting-token' }));
  mocks.checkActiveCall.mockResolvedValue(
    ok({ callId: 'call-1', channelId: 'channel-1' })
  );
  mocks.getCallRecord.mockResolvedValue(
    ok({ callId: 'call-1', participants: [] })
  );
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

function setup() {
  const [active, setActive] = createSignal(true);
  const [tab, setTab] = createSignal<ChannelTabId>('call');
  let finishDisconnect!: () => void;
  let failDisconnect!: (error: Error) => void;
  const disconnect = vi.fn(() => {
    setActive(false);
    return new Promise<void>((resolve, reject) => {
      finishDisconnect = resolve;
      failDisconnect = reject;
    });
  });
  function Harness() {
    mocks.call = {
      ...createPreviewCallState(),
      isInCall: active,
      activeChannelId: () => (active() ? 'channel-1' : null),
      activeCallId: () => (active() ? 'call-1' : null),
      remoteParticipants: () => new Map(),
      disconnectSession: disconnect,
    };
    return (
      <QueryClientProvider client={queryClient}>
        <ChannelTabProvider activeTab={tab} setActiveTab={setTab}>
          <Show when={tab() === 'call'} fallback={<div>Channel messages</div>}>
            <ChannelCallTab channelId="channel-1" />
          </Show>
        </ChannelTabProvider>
      </QueryClientProvider>
    );
  }
  render(Harness);
  return {
    disconnect,
    finishDisconnect: () => finishDisconnect(),
    failDisconnect: () => failDisconnect(new Error('RTC disconnect failed')),
  };
}

it.each(['pending', 'rejected'] as const)(
  'returns to Messages immediately when RTC disconnect is %s',
  async (outcome) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave call' }));
    // Tab switching must follow explicit intent, not the completion of RTC teardown.
    expect(screen.getByText('Channel messages')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    expect(state.disconnect).toHaveBeenCalledOnce();
    expect(mocks.leaveCall).not.toHaveBeenCalled();

    if (outcome === 'rejected') state.failDisconnect();
    else state.finishDisconnect();
    await waitFor(() =>
      expect(mocks.leaveCall).toHaveBeenCalledExactlyOnceWith('channel-1')
    );
    expect(screen.getByText('Channel messages')).toBeTruthy();
    if (outcome === 'rejected') expect(error).toHaveBeenCalled();
  }
);
