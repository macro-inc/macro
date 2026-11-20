/**
 * @vitest-environment jsdom
 */
import type { ChannelEntity } from '@entity/types/entity';
import type { ChannelParticipant } from '@service-storage/generated/schemas/channelParticipant';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const testQueryClient = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../client', () => ({
  get queryClient() {
    return testQueryClient.current;
  },
}));

const detail = vi.hoisted(() => ({
  pending: true,
  error: null as unknown,
  entities: [] as unknown[],
  listeners: new Set<() => void>(),
}));
vi.mock('./detail', async () => {
  const { createSignal } = await import('solid-js');
  const [version, setVersion] = createSignal(0);
  detail.listeners.add(() => setVersion((value) => value + 1));
  return {
    createChannelDetailQuery: vi.fn(() => ({
      get isPending() {
        version();
        return detail.pending;
      },
      isLoading: false,
      get error() {
        version();
        return detail.error;
      },
      get data() {
        version();
        if (detail.pending || detail.error) return undefined;
        return { entities: detail.entities };
      },
    })),
  };
});
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));

const storage = vi.hoisted(() => ({
  addParticipantsToChannel: vi.fn(),
  removeParticipantsFromChannel: vi.fn(),
  getChannelParticipants: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: storage }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import { useChannelParticipantsQuery } from './channel-participants';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from './participants';

function participant(
  userId: string,
  joinedAt: string,
  role: ChannelParticipant['role'] = 'member'
): ChannelParticipant {
  return {
    channel_id: 'channel-1',
    user_id: userId,
    role,
    joined_at: joinedAt,
    left_at: null,
  };
}

function setDetail(participants: ChannelParticipant[] | undefined) {
  detail.pending = participants === undefined;
  detail.error = null;
  detail.entities = participants
    ? [
        {
          id: 'channel-1',
          type: 'channel',
          participants,
        } as Partial<ChannelEntity>,
      ]
    : [];
  for (const listener of detail.listeners) listener();
}

/** The by-id read came back without the channel. */
function missChannel() {
  detail.pending = false;
  detail.entities = [];
  for (const listener of detail.listeners) listener();
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  testQueryClient.current = client;
  let query!: ReturnType<typeof useChannelParticipantsQuery>;
  let add!: ReturnType<typeof useAddParticipantsMutation>;
  let remove!: ReturnType<typeof useRemoveParticipantsMutation>;
  const [channelId] = createSignal('channel-1');
  // A component, so the hooks' reads are not tracked by the render.
  function Harness() {
    query = useChannelParticipantsQuery(channelId);
    add = useAddParticipantsMutation();
    remove = useRemoveParticipantsMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const ids = () => query.data?.map((participant) => participant.user_id);
  return { query, add, remove, ids };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  setDetail(undefined);
});

describe('useChannelParticipantsQuery', () => {
  it('reads the participants from the channel record', () => {
    const { query, ids } = mount();
    expect(query.isPending).toBe(true);
    expect(query.data).toBeUndefined();

    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);

    expect(query.isSuccess).toBe(true);
    expect(ids()).toEqual(['owner', 'member']);
    expect(query.data?.[0]?.role).toBe('owner');
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
  });

  it('reads a channel the soup read leaves out from REST', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        {
          channel_id: 'channel-1',
          user_id: 'owner',
          role: 'owner',
          joined_at: '2026-01-01T00:00:00Z',
        },
        {
          channel_id: 'channel-1',
          user_id: 'member',
          role: 'member',
          joined_at: '2026-01-02T00:00:00Z',
        },
      ])
    );
    const { query, ids } = mount();
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
    missChannel();

    expect(query.isPending).toBe(true);
    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'member']);
    expect(storage.getChannelParticipants).toHaveBeenCalledWith({
      channel_id: 'channel-1',
    });
  });

  it('never asks REST while the GraphQL read is pending', async () => {
    const { query } = mount();
    expect(query.isPending).toBe(true);
    await Promise.resolve();

    expect(query.isSuccess).toBe(false);
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
  });

  it('reads REST when the GraphQL read fails before it has answered', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        {
          channel_id: 'channel-1',
          user_id: 'owner',
          role: 'owner',
          joined_at: '2026-01-01T00:00:00Z',
        },
      ])
    );
    const { query, ids } = mount();

    detail.pending = false;
    detail.error = new Error('unavailable');
    for (const listener of detail.listeners) listener();

    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
    expect(storage.getChannelParticipants).toHaveBeenCalledWith({
      channel_id: 'channel-1',
    });

    // The record wins once the GraphQL read recovers.
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    expect(ids()).toEqual(['owner', 'member']);
  });

  it('has no participants for a channel the viewer cannot read', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      err([{ code: 'UNAUTHORIZED', message: 'forbidden' }])
    );
    const { query } = mount();
    missChannel();

    await waitFor(() => expect(query.isPending).toBe(false));
    expect(query.isSuccess).toBe(false);
    expect(query.data).toBeUndefined();
  });

  it('shows an add while it is pending and keeps it once it succeeds', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    const response = Promise.withResolvers<unknown>();
    storage.addParticipantsToChannel.mockReturnValue(response.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new', 'owner'] });
    await waitFor(() => expect(ids()).toEqual(['owner', 'new']));

    response.resolve(ok({}));
    await waitFor(() => expect(add.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'new']);

    // The channel's soup update arrives; nothing is shown twice.
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('new', '2026-01-03T00:00:00Z'),
    ]);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('rolls an add back when it fails', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    const response = Promise.withResolvers<unknown>();
    storage.addParticipantsToChannel.mockReturnValue(response.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await waitFor(() => expect(ids()).toEqual(['owner', 'new']));

    response.resolve(err([{ code: 'HTTP_ERROR', message: 'refused' }]));
    await waitFor(() => expect(add.isError).toBe(true));
    expect(ids()).toEqual(['owner']);
  });

  it('hides a removed participant until the record drops them, and restores them on failure', async () => {
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    const response = Promise.withResolvers<unknown>();
    storage.removeParticipantsFromChannel.mockReturnValue(response.promise);
    const { remove, ids } = mount();

    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await waitFor(() => expect(ids()).toEqual(['owner']));

    response.resolve(err([{ code: 'HTTP_ERROR', message: 'refused' }]));
    await waitFor(() => expect(remove.isError).toBe(true));
    expect(ids()).toEqual(['owner', 'member']);
  });

  it('ignores changes made to another channel', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockReturnValue(new Promise(() => {}));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-2', participants: ['other'] });
    await waitFor(() => expect(add.isPending).toBe(true));
    expect(ids()).toEqual(['owner']);
  });

  it('keeps the participants on screen when a refresh fails', () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    const { query, ids } = mount();

    detail.error = new Error('refresh failed');
    for (const listener of detail.listeners) listener();

    expect(query.isSuccess).toBe(true);
    expect(ids()).toEqual(['owner']);
    // A record it already read stays authoritative: no REST read.
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
  });

  it('lets a later change made elsewhere win over a confirmed remove', async () => {
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    const { remove, ids } = mount();

    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await waitFor(() => expect(remove.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);

    // The soup update confirms the remove, then the member is added back elsewhere.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-05T00:00:00Z'),
    ]);
    expect(ids()).toEqual(['owner', 'member']);
  });

  it('stops showing a succeeded add whose soup update never arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'new']);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(ids()).toEqual(['owner', 'new']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ids()).toEqual(['owner']);
  });

  it('lets a remove win over an earlier add whose soup update has not arrived', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const removal = Promise.withResolvers<unknown>();
    storage.removeParticipantsFromChannel.mockReturnValue(removal.promise);
    const { add, remove, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await waitFor(() => expect(add.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'new']);

    remove.mutate({ channelId: 'channel-1', participants: ['new'] });
    await waitFor(() => expect(ids()).toEqual(['owner']));

    // The remove succeeds against a record that never showed the add.
    removal.resolve(ok({}));
    await waitFor(() => expect(remove.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
  });
});
