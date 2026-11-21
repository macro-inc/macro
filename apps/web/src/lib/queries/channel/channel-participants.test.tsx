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
import { channelKeys } from './keys';
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

/** The by-id read answered with these channels. */
function setChannels(channels: Record<string, ChannelParticipant[]>) {
  detail.pending = false;
  detail.error = null;
  detail.entities = Object.entries(channels).map(
    ([id, participants]) =>
      ({ id, type: 'channel', participants }) as Partial<ChannelEntity>
  );
  for (const listener of detail.listeners) listener();
}

/** The by-id read came back without the channel. */
function missChannel() {
  detail.pending = false;
  detail.entities = [];
  for (const listener of detail.listeners) listener();
}

/** The by-id read failed. */
function failDetail() {
  detail.pending = false;
  detail.error = new Error('unavailable');
  for (const listener of detail.listeners) listener();
}

function restRow(
  userId: string,
  joinedAt: string,
  role: ChannelParticipant['role'] = 'member'
) {
  return {
    channel_id: 'channel-1',
    user_id: userId,
    role,
    joined_at: joinedAt,
  };
}

function restClient() {
  return testQueryClient.current as QueryClient;
}

function mount(
  options: { staleTime?: number; readers?: number; apart?: boolean } = {}
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: options.staleTime },
      mutations: { retry: false },
    },
  });
  testQueryClient.current = client;
  let query!: ReturnType<typeof useChannelParticipantsQuery>;
  let add!: ReturnType<typeof useAddParticipantsMutation>;
  let remove!: ReturnType<typeof useRemoveParticipantsMutation>;
  const [channelId, setChannel] = createSignal('channel-1');
  // A reader on another view, which moves between channels on its own.
  const [apartId, setApart] = createSignal('channel-1');
  let apart: ReturnType<typeof useChannelParticipantsQuery> | undefined;
  // A component, so the hooks' reads are not tracked by the render.
  function Harness() {
    // Other components reading the same channel.
    for (let i = 1; i < (options.readers ?? 1); i++)
      useChannelParticipantsQuery(channelId);
    if (options.apart) apart = useChannelParticipantsQuery(apartId);
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
  const apartIds = () => apart?.data?.map((participant) => participant.user_id);
  return { query, add, remove, ids, setChannel, setApart, apartIds };
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

  it('follows REST while the GraphQL read keeps failing', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
    );
    const { query, ids } = mount();
    failDetail();
    await waitFor(() => expect(ids()).toEqual(['owner']));

    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('member', '2026-01-02T00:00:00Z'),
      ])
    );
    await restClient().invalidateQueries();

    await waitFor(() => expect(ids()).toEqual(['owner', 'member']));
    expect(query.isSuccess).toBe(true);
  });

  it('keeps reading REST for a channel the soup read leaves out when a refresh fails', async () => {
    let answer!: (value: unknown) => void;
    storage.getChannelParticipants.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const { query, ids } = mount();
    missChannel();
    await waitFor(() =>
      expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1)
    );

    failDetail();
    expect(query.isPending).toBe(true);
    answer(ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')]));

    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
  });

  it('reads REST when a read that answered before fails after going pending again', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
    );
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    const { query, ids } = mount();
    expect(ids()).toEqual(['owner']);

    // A replaced GraphQL client starts its read over.
    setDetail(undefined);
    expect(query.isPending).toBe(true);
    failDetail();

    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
  });

  it('asks REST again when the GraphQL read fails, over rows cached earlier', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('member', '2026-01-02T00:00:00Z'),
      ])
    );
    // The app's five-minute freshness, and REST rows from before the member joined.
    const { query, ids } = mount({ staleTime: 300_000 });
    restClient().setQueryData(
      channelKeys.participantsFallback('channel-1').queryKey,
      [{ ...restRow('owner', '2026-01-01T00:00:00Z', 'owner'), left_at: null }]
    );
    failDetail();

    await waitFor(() => expect(ids()).toEqual(['owner', 'member']));
    expect(query.isSuccess).toBe(true);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
  });

  it('keeps a succeeded add on a REST roster after its overlay expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    storage.getChannelParticipants
      .mockResolvedValueOnce(
        ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
      )
      .mockResolvedValue(
        ok([
          restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          restRow('new', '2026-01-03T00:00:00Z'),
        ])
      );
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();
    missChannel();
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);

    expect(ids()).toEqual(['owner', 'new']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
  });

  it('keeps a succeeded remove on a REST roster after its overlay expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    storage.getChannelParticipants
      .mockResolvedValueOnce(
        ok([
          restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          restRow('member', '2026-01-02T00:00:00Z'),
        ])
      )
      .mockResolvedValue(
        ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
      );
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    const { remove, ids } = mount();
    failDetail();
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'member']));

    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await vi.waitFor(() => expect(remove.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);

    expect(ids()).toEqual(['owner']);
  });

  it('rereads REST after a write that a read already in flight predates', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let answerFirst!: (value: unknown) => void;
    storage.getChannelParticipants
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirst = resolve;
        })
      )
      .mockResolvedValue(
        ok([
          restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          restRow('new', '2026-01-03T00:00:00Z'),
        ])
      );
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();
    missChannel();
    await vi.waitFor(() =>
      expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1)
    );

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    // The first read answers with the roster from before the add.
    answerFirst(ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')]));
    await vi.waitFor(() =>
      expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2)
    );
    await vi.advanceTimersByTimeAsync(31_000);

    expect(ids()).toEqual(['owner', 'new']);
  });

  it('finishes a write without waiting for the REST reread', async () => {
    storage.getChannelParticipants
      .mockResolvedValueOnce(
        ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
      )
      .mockReturnValue(new Promise(() => undefined));
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();
    missChannel();
    await waitFor(() => expect(ids()).toEqual(['owner']));

    add.mutate({ channelId: 'channel-1', participants: ['new'] });

    await waitFor(() => expect(add.isSuccess).toBe(true));
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('matches REST rows to the channel whatever the id letter case', async () => {
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        {
          ...restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          channel_id: 'CHANNEL-1',
        },
      ])
    );
    const { query, ids } = mount();
    missChannel();

    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
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

  it('keeps a succeeded add whose soup update is late once the server says it holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('new', '2026-01-03T00:00:00Z'),
      ])
    );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ids()).toEqual(['owner', 'new']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);

    // Still shown a minute later, and once the soup update lands.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ids()).toEqual(['owner', 'new']);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('new', '2026-01-03T00:00:00Z'),
    ]);
    expect(ids()).toEqual(['owner', 'new']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
  });

  it('keeps a succeeded remove whose soup update is late once the server says it holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('gone', '2026-01-02T00:00:00Z'),
    ]);
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
    );
    const { remove, ids } = mount();

    remove.mutate({ channelId: 'channel-1', participants: ['gone'] });
    await vi.waitFor(() => expect(remove.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(91_000);
    expect(ids()).toEqual(['owner']);
  });

  it('keeps showing a succeeded add until the server answers whether it holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const answer = Promise.withResolvers<unknown>();
    storage.getChannelParticipants.mockReturnValue(answer.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(35_000);
    expect(ids()).toEqual(['owner', 'new']);

    // Someone removed them again meanwhile.
    answer.resolve(ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner']);
  });

  it('stops showing a succeeded add when the server does not answer whether it holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants
      .mockResolvedValueOnce(err([{ code: 'HTTP_ERROR', message: 'offline' }]))
      .mockReturnValueOnce(new Promise(() => {}));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['first'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner']);

    add.mutate({ channelId: 'channel-1', participants: ['second'] });
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'second']));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'second']);
    // The server's time to answer runs out.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ids()).toEqual(['owner']);
  });

  it('asks the server again for a change made after the last answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, restRow('a', '2026-01-03T00:00:00Z')]))
      .mockResolvedValueOnce(
        ok([
          owner,
          restRow('a', '2026-01-03T00:00:00Z'),
          restRow('b', '2026-01-04T00:00:00Z'),
        ])
      );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(10_000);
    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'a', 'b']));

    // The answer about `a`, which leaves `b` out, comes before `b`'s time runs out.
    await vi.advanceTimersByTimeAsync(21_000);
    expect(ids()).toEqual(['owner', 'a', 'b']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ids()).toEqual(['owner', 'a', 'b']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
  });

  it('reads REST when the first GraphQL read is slow, then follows the record', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    storage.getChannelParticipants.mockResolvedValue(
      ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
    );
    const { query, ids } = mount();

    await vi.advanceTimersByTimeAsync(2_900);
    expect(query.isPending).toBe(true);
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));
    expect(query.isSuccess).toBe(true);
    expect(query.isPending).toBe(false);

    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    expect(ids()).toEqual(['owner', 'member']);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
  });

  it('shows a succeeded add again when a later remove of them fails', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const removal = Promise.withResolvers<unknown>();
    storage.removeParticipantsFromChannel.mockReturnValue(removal.promise);
    const { add, remove, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await waitFor(() => expect(add.isSuccess).toBe(true));
    remove.mutate({ channelId: 'channel-1', participants: ['new'] });
    await waitFor(() => expect(ids()).toEqual(['owner']));

    removal.resolve(err([{ code: 'HTTP_ERROR', message: 'refused' }]));
    await waitFor(() => expect(remove.isError).toBe(true));
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('keeps the rest of an add when a later change succeeds for some of them', async () => {
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    const { add, remove, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['x', 'y'] });
    await waitFor(() => expect(add.isSuccess).toBe(true));
    remove.mutate({ channelId: 'channel-1', participants: ['y'] });
    await waitFor(() => expect(remove.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'x']);
  });

  it('asks about each change at its own time, and keeps the later answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const first = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        ok([
          owner,
          restRow('a', '2026-01-03T00:00:00Z'),
          restRow('b', '2026-01-04T00:00:00Z'),
        ])
      );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(1_000);
    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'a', 'b']));

    // The first question is still unanswered when `b`'s time runs out.
    await vi.advanceTimersByTimeAsync(30_500);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['owner', 'a', 'b']);

    // The older question's answer arrives last and changes nothing.
    first.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a', 'b']);
  });

  it('keeps the answer for each channel when the reader moves between channels during its checks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = participant('owner', '2026-01-01T00:00:00Z', 'owner');
    setChannels({ 'channel-1': [owner], 'channel-2': [owner] });
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const answers = new Map<string, PromiseWithResolvers<unknown>>();
    storage.getChannelParticipants.mockImplementation(
      ({ channel_id }: { channel_id: string }) => {
        const answer = Promise.withResolvers<unknown>();
        answers.set(channel_id, answer);
        return answer.promise;
      }
    );
    const { add, ids, setChannel } = mount();

    setChannel('channel-2');
    add.mutate({ channelId: 'channel-2', participants: ['b'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    setChannel('channel-1');
    await vi.advanceTimersByTimeAsync(5_000);
    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner', 'a']);

    // channel-2's question goes out, then channel-1's.
    setChannel('channel-2');
    await vi.advanceTimersByTimeAsync(26_000);
    setChannel('channel-1');
    await vi.advanceTimersByTimeAsync(5_000);
    setChannel('channel-2');
    expect([...answers.keys()]).toEqual(['channel-2', 'channel-1']);

    // channel-1's answer says `a` is not there; channel-2's arrives last.
    answers
      .get('channel-1')!
      .resolve(ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')]));
    answers
      .get('channel-2')!
      .resolve(
        ok([
          restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          restRow('b', '2026-01-03T00:00:00Z'),
        ])
      );
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'b']);
    setChannel('channel-1');
    expect(ids()).toEqual(['owner']);
  });

  it('judges a write shown over REST again against the GraphQL record that follows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const withNew = [owner, restRow('new', '2026-01-03T00:00:00Z')];
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner]))
      .mockResolvedValue(ok(withNew));
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();

    // The GraphQL read is slow, so REST answers; the write's REST reread shows it.
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));
    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'new']));

    // Then the GraphQL read, sent before the write, answers without it.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    expect(ids()).toEqual(['owner', 'new']);
    // Its time to show runs out and the server says it holds.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('waits for an older question when a newer one fails, and lets a newer answer decide over an older one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(1_000);
    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'a', 'b']));
    await vi.advanceTimersByTimeAsync(30_500);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);

    // The newer question fails: `a` waits for the older one, `b` has none.
    second.resolve(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a']);
    first.resolve(ok([owner, restRow('a', '2026-01-03T00:00:00Z')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a']);
  });

  it('decides a change from the newest question while it waits, not from an older answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(1_000);
    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'a', 'b']));
    await vi.advanceTimersByTimeAsync(30_500);

    // The older answer, without `a`, arrives while the newer question waits.
    first.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a', 'b']);
    second.resolve(
      ok([
        owner,
        restRow('a', '2026-01-03T00:00:00Z'),
        restRow('b', '2026-01-04T00:00:00Z'),
      ])
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a', 'b']);
  });

  it('shows someone who rejoined after a confirmed remove', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([restRow('owner', '2026-01-01T00:00:00Z', 'owner')])
    );
    const { remove, ids } = mount();

    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await vi.waitFor(() => expect(remove.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner']);

    // Added back elsewhere; the record skips the roster without them, and
    // the server, asked again, has them.
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('member', '2026-01-05T00:00:00Z'),
      ])
    );
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-05T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'member']);
  });

  it('keeps the people of an add the server says hold, and drops the rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('x', '2026-01-03T00:00:00Z'),
      ])
    );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['x', 'y'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'x']);
  });

  it('lets the change that finished last decide, whatever order they were sent in', async () => {
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-02T00:00:00Z'),
    ]);
    const removal = Promise.withResolvers<unknown>();
    storage.removeParticipantsFromChannel.mockReturnValue(removal.promise);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, remove, ids } = mount();

    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await waitFor(() => expect(ids()).toEqual(['owner']));
    add.mutate({ channelId: 'channel-1', participants: ['member'] });
    await waitFor(() => expect(add.isSuccess).toBe(true));

    // The remove, sent first, finishes last.
    removal.resolve(ok({}));
    await waitFor(() => expect(remove.isSuccess).toBe(true));
    expect(ids()).toEqual(['owner']);
  });

  it('shows someone who rejoined while their removal showed over REST, once the GraphQL record has them', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    storage.getChannelParticipants
      .mockResolvedValueOnce(
        ok([owner, restRow('member', '2026-01-02T00:00:00Z')])
      )
      .mockResolvedValue(ok([owner]));
    storage.removeParticipantsFromChannel.mockResolvedValue(ok({}));
    const { remove, ids } = mount();

    // The GraphQL read is slow, so REST answers; the write's REST reread shows it.
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'member']));
    remove.mutate({ channelId: 'channel-1', participants: ['member'] });
    await vi.waitFor(() => expect(remove.isSuccess).toBe(true));
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));

    // Added back elsewhere: the GraphQL record that arrives, and the server, have them.
    storage.getChannelParticipants.mockResolvedValue(
      ok([owner, restRow('member', '2026-01-05T00:00:00Z')])
    );
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'owner'),
      participant('member', '2026-01-05T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'member']);
  });

  it('asks the server again when the record changes after it said a change holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('new', '2026-01-03T00:00:00Z'),
      ])
    );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'new']);

    // A record read before the add arrives late, with another change in it.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('keeps a question still waiting when newer ones fill the list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const first = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      await vi.advanceTimersByTimeAsync(500);
      add.mutate({ channelId: 'channel-1', participants: [id] });
      await vi.waitFor(() => expect(add.variables?.participants).toEqual([id]));
      await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    }
    // Every change's time runs out: the first question waits, eight newer fail.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(9);
    expect(ids()).toEqual(['owner', 'a']);

    first.resolve(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('a', '2026-01-03T00:00:00Z'),
      ])
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ids()).toEqual(['owner', 'a']);
  });

  it('asks the server once for the readers mounted on one channel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      ok([
        restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
        restRow('new', '2026-01-03T00:00:00Z'),
      ])
    );
    const { add, ids } = mount({ readers: 3 });

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('waits out the time to show when the clock is set back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'offline' }])
    );
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    vi.setSystemTime(Date.now() - 5_000);
    // The timer wakes when, by the clock, five seconds are still to go.
    await vi.advanceTimersByTimeAsync(30_500);
    expect(storage.getChannelParticipants).not.toHaveBeenCalled();
    expect(ids()).toEqual(['owner', 'new']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(['owner']);
  });

  it('keeps showing a write started over against a newer read when the server does not answer at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner]))
      .mockResolvedValueOnce(
        ok([owner, restRow('new', '2026-01-03T00:00:00Z')])
      )
      .mockResolvedValue(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();

    // The GraphQL read is slow, so REST answers; the write's REST reread shows it.
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));
    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'new']));

    // A GraphQL read sent before the add arrives; the server check fails.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'new']);
    // Its time to show runs out, and the server still does not answer.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner']);
  });

  it('keeps an answer that named members over older ones when newer checks fail', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const first = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        ok([
          owner,
          restRow('a', '2026-01-03T00:00:00Z'),
          restRow('b', '2026-01-03T00:00:01Z'),
        ])
      )
      .mockResolvedValue(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      await vi.advanceTimersByTimeAsync(500);
      add.mutate({ channelId: 'channel-1', participants: [id] });
      await vi.waitFor(() => expect(add.variables?.participants).toEqual([id]));
      await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    }
    // The first check waits; the second says a and b hold; eight more fail.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(10);
    expect(ids()).toEqual(['owner', 'a', 'b']);

    // The first check, sent before the second, answers without a.
    first.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'a', 'b']);
  });

  it('does not take an answer from before the clock was set back for a later write', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const x = restRow('x', '2026-01-03T00:00:00Z');
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, x]))
      .mockResolvedValue(ok([owner, x, restRow('y', '2026-01-04T00:00:00Z')]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['x'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'x']);

    vi.setSystemTime(Date.now() - 60_000);
    add.mutate({ channelId: 'channel-1', participants: ['y'] });
    await vi.waitFor(() => expect(add.variables?.participants).toEqual(['y']));
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
    // y carries a join time from the earlier clock, so it sorts first.
    expect(ids()).toEqual(['owner', 'y', 'x']);
  });

  it('asks again on each record change while it asks whether a confirmed write holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const added = restRow('new', '2026-01-03T00:00:00Z');
    const other = restRow('other', '2026-01-04T00:00:00Z');
    const second = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, added]))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(ok([owner, added, other]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'new']);

    // Late records without the add: a role change, then someone else joining.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'new']);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'admin'),
      participant('other', '2026-01-04T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['owner', 'other', 'new']);
    second.resolve(ok([owner, added]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other', 'new']);
  });

  it('asks anew when the record changes in the millisecond another check was sent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const a = restRow('a', '2026-01-03T00:00:00Z');
    const b = restRow('b', '2026-01-04T00:00:00Z');
    const second = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, a]))
      // b's check goes out; in the same millisecond a record without a arrives.
      .mockImplementationOnce(() => {
        setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
        return second.promise;
      })
      .mockResolvedValue(ok([owner, b]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);

    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(add.variables?.participants).toEqual(['b']));
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    second.resolve(ok([owner, a, b]));
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    expect(ids()).not.toContain('a');
  });

  it('shares the check due for an earlier write with a reader back from another channel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = participant('owner', '2026-01-01T00:00:00Z', 'owner');
    setChannels({ 'channel-1': [owner], 'channel-2': [owner] });
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    storage.getChannelParticipants
      .mockResolvedValueOnce(
        ok([
          restRow('owner', '2026-01-01T00:00:00Z', 'owner'),
          restRow('a', '2026-01-03T00:00:00Z'),
        ])
      )
      .mockResolvedValue(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    const { add, ids, setApart, apartIds } = mount({ apart: true });

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.waitFor(() => expect(apartIds()).toEqual(['owner', 'a']));
    setApart('channel-2');
    // The reader that stayed asks once a's time runs out; the server holds a.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
    add.mutate({ channelId: 'channel-1', participants: ['b'] });
    await vi.waitFor(() => expect(add.variables?.participants).toEqual(['b']));
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));

    // The other reader comes back: a is due, b is not.
    setApart('channel-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(1);
    expect(apartIds()).toEqual(['owner', 'a', 'b']);
    expect(ids()).toEqual(['owner', 'a', 'b']);
  });

  it('asks again when the record answers again as the time to show of a write started over runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const added = restRow('new', '2026-01-03T00:00:00Z');
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner]))
      .mockResolvedValueOnce(ok([owner, added]))
      .mockResolvedValueOnce(err([{ code: 'HTTP_ERROR', message: 'offline' }]))
      .mockResolvedValue(ok([owner, added]));
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const { add, ids } = mount();

    await vi.advanceTimersByTimeAsync(3_100);
    await vi.waitFor(() => expect(ids()).toEqual(['owner']));
    add.mutate({ channelId: 'channel-1', participants: ['new'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.waitFor(() => expect(ids()).toEqual(['owner', 'new']));
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    expect(ids()).toEqual(['owner', 'new']);

    // The same record answers again just after its time ran out, before the
    // reader's timer runs.
    vi.setSystemTime(Date.now() + 31_000);
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'new']);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(4);
    expect(ids()).toEqual(['owner', 'new']);
  });

  it('drops a confirmed write a recheck refutes while later record changes still wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const second = Promise.withResolvers<unknown>();
    const third = Promise.withResolvers<unknown>();
    const fourth = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, restRow('a', '2026-01-03T00:00:00Z')]))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
      .mockReturnValueOnce(fourth.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);

    // Someone removes a; the record changes twice before the first recheck answers.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
    await vi.advanceTimersByTimeAsync(0);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'admin'),
      participant('other', '2026-01-04T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    // The answer hides a at once, while the newer checks still wait.
    second.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other']);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'admin'),
      participant('other', '2026-01-04T00:00:00Z', 'admin'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(4);
    third.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other']);
    fourth.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'other']);
  });

  it('lets a recheck already out when an older one answers decide whether a confirmed write holds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const a = restRow('a', '2026-01-03T00:00:00Z');
    const other = restRow('other', '2026-01-04T00:00:00Z');
    const second = Promise.withResolvers<unknown>();
    const third = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, a]))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
      .mockResolvedValue(ok([owner, a, other]));
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);

    // Someone removes a, who rejoins; two late records ask twice.
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
    await vi.advanceTimersByTimeAsync(0);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'admin'),
      participant('other', '2026-01-04T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    // The first recheck saw a gone; the second, already out, sees them back.
    second.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other']);
    third.resolve(ok([owner, a, other]));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'other', 'a']);
  });

  it('does not let an older recheck that answers late undo a newer one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const a = restRow('a', '2026-01-03T00:00:00Z');
    // Answers queued by earlier tests would shift these checks.
    storage.getChannelParticipants.mockReset();
    const checks = [0, 1, 2, 3].map(() => Promise.withResolvers<unknown>());
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, a]))
      .mockReturnValueOnce(checks[0]!.promise)
      .mockReturnValueOnce(checks[1]!.promise)
      .mockReturnValueOnce(checks[2]!.promise)
      .mockReturnValueOnce(checks[3]!.promise);
    const { add, ids } = mount();
    const records = [
      [participant('owner', '2026-01-01T00:00:00Z', 'admin')],
      [
        participant('owner', '2026-01-01T00:00:00Z', 'admin'),
        participant('other', '2026-01-04T00:00:00Z'),
      ],
      [
        participant('owner', '2026-01-01T00:00:00Z', 'admin'),
        participant('other', '2026-01-04T00:00:00Z', 'admin'),
      ],
      [
        participant('owner', '2026-01-01T00:00:00Z', 'owner'),
        participant('other', '2026-01-04T00:00:00Z', 'admin'),
      ],
    ];
    const recordChanges = async (from: number, to: number) => {
      for (const record of records.slice(from, to)) {
        setDetail(record);
        await vi.advanceTimersByTimeAsync(0);
      }
    };

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);

    await recordChanges(0, 2);
    checks[0]!.resolve(ok([owner, a]));
    await vi.advanceTimersByTimeAsync(0);
    await recordChanges(2, 4);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(5);
    // The third check sees a; the second, sent before it, answers late without them.
    checks[2]!.resolve(ok([owner, a]));
    await vi.advanceTimersByTimeAsync(0);
    checks[1]!.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other', 'a']);
    checks[3]!.resolve(ok([owner, a]));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'other', 'a']);
  });

  it('lets a newer check still out decide when a later recheck fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const a = restRow('a', '2026-01-03T00:00:00Z');
    // Answers queued by earlier tests would shift these checks.
    storage.getChannelParticipants.mockReset();
    const checks = [0, 1, 2].map(() => Promise.withResolvers<unknown>());
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, a]))
      .mockReturnValueOnce(checks[0]!.promise)
      .mockReturnValueOnce(checks[1]!.promise)
      .mockReturnValueOnce(checks[2]!.promise);
    const { add, ids } = mount();

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);

    for (const record of [
      [participant('owner', '2026-01-01T00:00:00Z', 'admin')],
      [
        participant('owner', '2026-01-01T00:00:00Z', 'admin'),
        participant('other', '2026-01-04T00:00:00Z'),
      ],
      [
        participant('owner', '2026-01-01T00:00:00Z', 'admin'),
        participant('other', '2026-01-04T00:00:00Z', 'admin'),
      ],
    ]) {
      setDetail(record);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(4);
    // a left, then rejoined: the second check saw them gone, the third back.
    checks[0]!.resolve(ok([owner]));
    await vi.advanceTimersByTimeAsync(0);
    checks[2]!.resolve(err([{ code: 'HTTP_ERROR', message: 'offline' }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(ids()).toEqual(['owner', 'other']);
    checks[1]!.resolve(ok([owner, a]));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'other', 'a']);
  });

  it('keeps two readers of a channel agreeing when an older recheck answers before one joins a newer check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'owner')]);
    storage.addParticipantsToChannel.mockResolvedValue(ok({}));
    const owner = restRow('owner', '2026-01-01T00:00:00Z', 'owner');
    const a = restRow('a', '2026-01-03T00:00:00Z');
    const other = restRow('other', '2026-01-04T00:00:00Z');
    const second = Promise.withResolvers<unknown>();
    const third = Promise.withResolvers<unknown>();
    storage.getChannelParticipants
      .mockResolvedValueOnce(ok([owner, a]))
      .mockReturnValueOnce(second.promise)
      // The other reader sends the newer check; the older answers before this
      // reader asks.
      .mockImplementationOnce(() => {
        second.resolve(ok([owner]));
        return third.promise;
      })
      .mockResolvedValue(ok([owner, a, other]));
    const { add, ids, apartIds } = mount({ apart: true });

    add.mutate({ channelId: 'channel-1', participants: ['a'] });
    await vi.waitFor(() => expect(add.isSuccess).toBe(true));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'a']);
    expect(apartIds()).toEqual(['owner', 'a']);

    setDetail([participant('owner', '2026-01-01T00:00:00Z', 'admin')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(2);
    setDetail([
      participant('owner', '2026-01-01T00:00:00Z', 'admin'),
      participant('other', '2026-01-04T00:00:00Z'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getChannelParticipants).toHaveBeenCalledTimes(3);
    third.resolve(ok([owner, a, other]));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ids()).toEqual(['owner', 'other', 'a']);
    expect(apartIds()).toEqual(['owner', 'other', 'a']);
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
