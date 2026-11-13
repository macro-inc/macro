import { ThrownResultError } from '@core/util/result';
import type { ChannelAccessRequestState } from '@service-storage/generated/schemas/channelAccessRequestState';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { beforeEach, expect, it, vi } from 'vitest';
import { useMyChannelAccessRequestState } from './my-access-request';

type Snapshot = {
  isPending: boolean;
  isFetching: boolean;
  isPaused: boolean;
  isFetchedAfterMount: boolean;
  isError: boolean;
  error: Error | null;
  data: ChannelAccessRequestState | undefined;
  refetch: () => Promise<void>;
};

let snapshot: Snapshot;
vi.mock('@queries/channel/access-requests', () => ({
  useMyChannelAccessRequestQuery: () => snapshot,
}));

const pending: ChannelAccessRequestState = {
  can_request: true,
  request: {
    id: 'request-1',
    channel_id: 'channel-1',
    requester_id: 'macro|requester@example.com',
    status: 'pending',
    created_at: '2026-10-21T12:00:00Z',
  },
};

beforeEach(() => vi.clearAllMocks());

it.each(['fetching', 'paused'] as const)(
  'withholds a cached request until this mount finishes its own %s read',
  (mode) => {
    const [query, update] = createStore<Snapshot>({
      isPending: false,
      isFetching: mode === 'fetching',
      isPaused: mode === 'paused',
      isFetchedAfterMount: false,
      isError: false,
      error: null,
      data: pending,
      refetch: async () => {},
    });
    snapshot = query;
    const source = useMyChannelAccessRequestState(
      () => 'channel-1',
      () => true
    );
    expect(source.read()).toEqual({ status: 'loading' });
    update({
      isFetching: false,
      isPaused: false,
      isFetchedAfterMount: true,
      data: { can_request: false },
    });
    expect(source.read()).toEqual({
      status: 'ready',
      state: { can_request: false },
    });
  }
);

it('offers recovery after an initial read is cancelled back to idle cached data', () => {
  snapshot = {
    isPending: false,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: false,
    isError: false,
    error: null,
    data: pending,
    refetch: async () => {},
  };
  const source = useMyChannelAccessRequestState(
    () => 'channel-1',
    () => true
  );
  expect(source.read()).toEqual({ status: 'error' });
});

it.each([undefined, pending])(
  'reports a missing channel instead of a cached request: %s',
  (data) => {
    snapshot = {
      isPending: false,
      isFetching: false,
      isPaused: false,
      isFetchedAfterMount: true,
      isError: true,
      error: new ThrownResultError([{ code: 'NOT_FOUND', message: 'Missing' }]),
      data,
      refetch: async () => {},
    };
    const source = useMyChannelAccessRequestState(
      () => 'channel-1',
      () => true
    );
    expect(source.read()).toEqual({ status: 'not-found' });
  }
);

it('exposes a failed read and recovers through an explicit refresh', async () => {
  const [query, update] = createStore<Snapshot>({
    isPending: false,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    isError: true,
    error: new Error('Offline'),
    data: pending,
    refetch: vi.fn(async () => {
      update({
        isError: false,
        error: null,
        data: { can_request: true, request: null },
      });
    }),
  });
  snapshot = query;
  const source = useMyChannelAccessRequestState(
    () => 'channel-1',
    () => true
  );
  expect(source.read()).toEqual({ status: 'error' });
  await source.refresh();
  expect(query.refetch).toHaveBeenCalledOnce();
  expect(source.read()).toEqual({
    status: 'ready',
    state: { can_request: true, request: null },
  });
});

it('does not read cached request data while authentication is disabled', () => {
  const [enabled, enable] = createSignal(false);
  snapshot = {
    isPending: false,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    isError: false,
    error: null,
    data: pending,
    refetch: async () => {},
  };
  const source = useMyChannelAccessRequestState(() => 'channel-1', enabled);
  expect(source.read()).toEqual({ status: 'loading' });
  enable(true);
  expect(source.read()).toEqual({ status: 'ready', state: pending });
});
