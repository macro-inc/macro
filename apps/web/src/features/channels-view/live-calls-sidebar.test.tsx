import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeCalls: vi.fn(),
  activeMeetings: vi.fn(),
  join: vi.fn(),
  open: vi.fn(),
  navigate: vi.fn(),
  dismiss: vi.fn(),
  incoming: () => [] as { callId: string }[],
  joinedCallId: undefined as string | undefined,
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    }),
  };
});
vi.mock('@service-call/client', () => ({
  callServiceClient: {
    getActiveCalls: mocks.activeCalls,
    getActiveMeetings: mocks.activeMeetings,
  },
}));
vi.mock('@queries/storage/entity-mutations', () => ({
  updateEntitySharePolicy: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLS: true }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({
    channelsById: () => ({
      channel: { name: 'Design' },
      dm: { name: 'Teammate' },
      backing: { name: 'Quick call backing channel' },
    }),
  }),
}));
vi.mock('@core/user/util', () => ({ idToDisplayName: () => 'Alex' }));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => ({
    isInCall: () => !!mocks.joinedCallId,
    activeCallId: () => mocks.joinedCallId,
  }),
}));
vi.mock('@channel/Call/join-channel-call', () => ({
  joinChannelCall: mocks.join,
}));
vi.mock('@channel/Call/open-channel-call-tab', () => ({
  openChannelCallTab: mocks.open,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@app/features/block-call/sidebar/incoming-calls', () => ({
  useVisibleIncomingCalls: () => () => mocks.incoming(),
  dismissIncomingCallEverywhere: mocks.dismiss,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import {
  setActiveCallEndedCache,
  setActiveCallStartedCache,
} from '@queries/call/call';
import { queryClient } from '@queries/client';
import { ChannelsLiveCallsSidebar } from './live-calls-sidebar';

function mount() {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <ChannelsLiveCallsSidebar />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeCalls.mockResolvedValue(ok([]));
  mocks.activeMeetings.mockResolvedValue(ok([]));
  mocks.join.mockResolvedValue(undefined);
  mocks.incoming = () => [];
  mocks.joinedCallId = undefined;
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

it('updates visible channel and DM calls newest first as calls start and end', async () => {
  mount();
  await waitFor(() => expect(mocks.activeCalls).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.activeMeetings).toHaveBeenCalledOnce());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(document.querySelector('[data-live-calls-sidebar]')).toBeNull();

  setActiveCallStartedCache({
    callId: 'design-call',
    channelId: 'channel',
    createdAt: '2026-01-01T10:00:00Z',
    createdBy: 'creator',
  });
  setActiveCallStartedCache({
    callId: 'dm-call',
    channelId: 'dm',
    createdAt: '2026-01-01T11:00:00Z',
    createdBy: 'creator',
  });
  setActiveCallStartedCache({
    callId: 'hidden-call',
    channelId: 'unavailable',
    createdAt: '2026-01-01T12:00:00Z',
    createdBy: 'creator',
  });

  await waitFor(() =>
    expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual(
      ['TeammateJoin', 'DesignJoin']
    )
  );
  await userEvent.click(screen.getByRole('button', { name: 'Join Teammate' }));
  expect(mocks.join).toHaveBeenCalledWith('dm', {
    kind: 'join',
    callId: 'dm-call',
  });

  setActiveCallEndedCache({ callId: 'dm-call', channelId: 'dm' });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Join Teammate' })).toBeNull()
  );
  expect(screen.getByRole('button', { name: 'Join Design' })).toBeDefined();
  setActiveCallEndedCache({ callId: 'design-call', channelId: 'channel' });
  await waitFor(() =>
    expect(document.querySelector('[data-live-calls-sidebar]')).toBeNull()
  );
});

it('lists a quick call once after channel calls and opens its meeting', async () => {
  mocks.activeCalls.mockResolvedValue(
    ok([
      { callId: 'design-call', channelId: 'channel' },
      { callId: 'quick-call', channelId: 'backing' },
    ])
  );
  mocks.activeMeetings.mockResolvedValue(
    ok([
      {
        id: 'meeting',
        callId: 'quick-call',
        createdBy: 'creator',
        title: 'Quick call',
        shareToken: 'test-share-token',
      },
    ])
  );
  mount();
  await screen.findByRole('button', { name: 'Join Call with Alex' });
  await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
  expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual([
    'DesignJoin',
    'Call with AlexJoin',
  ]);
  await userEvent.click(
    screen.getByRole('button', { name: 'Join Call with Alex' })
  );
  expect(mocks.navigate).toHaveBeenCalledWith('/meet/join/test-share-token');
  expect(mocks.join).not.toHaveBeenCalled();
});

it('dismisses ringing without removing the live call and opens the joined call', async () => {
  const [incoming, setIncoming] = createSignal([{ callId: 'design-call' }]);
  mocks.incoming = incoming;
  mocks.dismiss.mockImplementation(() => setIncoming([]));
  mocks.joinedCallId = 'dm-call';
  mocks.activeCalls.mockResolvedValue(
    ok([
      { callId: 'design-call', channelId: 'channel' },
      { callId: 'dm-call', channelId: 'dm' },
    ])
  );
  mount();

  await userEvent.click(
    await screen.findByRole('button', { name: 'Dismiss Design' })
  );
  expect(mocks.dismiss).toHaveBeenCalledWith('design-call', 'viewer');
  expect(screen.queryByRole('button', { name: 'Dismiss Design' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Join Design' })).toBeDefined();
  expect(mocks.join).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Open Teammate' }));
  expect(mocks.open).toHaveBeenCalledWith('dm');
  expect(mocks.join).not.toHaveBeenCalled();
});
