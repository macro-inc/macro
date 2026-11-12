import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetChannelSync } from '../catch-up';
import type { FetchChannelServerPage } from '../pages';
import {
  CHANNEL_EVICTION_AGE_MS,
  evictIdleChannels,
  PREWARM_RECENT_CHANNELS,
  prewarmChannelIds,
  runChannelPrewarm,
} from '../prewarm';
import { devicePage, fakeHost } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));
vi.mock('../../../client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

const at = (minute: number) =>
  `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`;

const channel = (
  id: string,
  fields: { viewed?: number; interacted?: number; latest?: number } = {},
  isParticipant = true
) => ({
  id,
  is_participant: isParticipant,
  viewed_at: fields.viewed === undefined ? null : at(fields.viewed),
  interacted_at: fields.interacted === undefined ? null : at(fields.interacted),
  latest_non_thread_message:
    fields.latest === undefined
      ? null
      : {
          content: '',
          created_at: at(fields.latest),
          mentions: [],
          message_id: id,
          sender_id: 'macro|sender@example.test',
          updated_at: at(fields.latest),
        },
});

afterEach(() => resetChannelSync());

describe('prewarmChannelIds', () => {
  it('lists unread channels newest first, then the most recently used', () => {
    expect(
      prewarmChannelIds([
        channel('read-old', { viewed: 5, latest: 4 }),
        channel('unread-old', { viewed: 1, latest: 2 }),
        channel('read-new', { viewed: 30, latest: 20 }),
        channel('unread-new', { viewed: 3, latest: 40 }),
        channel('never-opened', { latest: 10 }),
        channel('not-joined', { viewed: 1, latest: 50 }, false),
        channel('empty'),
      ])
    ).toEqual([
      'unread-new',
      'never-opened',
      'unread-old',
      'read-new',
      'read-old',
    ]);
  });

  it('keeps only the twenty most recently used read channels', () => {
    const channels = Array.from({ length: 30 }, (_, index) =>
      channel(`c${index}`, { viewed: index + 1, interacted: 0, latest: 0 })
    );
    const ids = prewarmChannelIds(channels);
    expect(ids).toHaveLength(PREWARM_RECENT_CHANNELS);
    expect(ids[0]).toBe('c29');
    expect(ids).not.toContain('c9');
  });
});

describe('runChannelPrewarm', () => {
  const signal = () => new AbortController().signal;

  it('fetches the latest page of a channel the device does not hold', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      entries: [],
      olderCursor: null,
      newerCursor: null,
      seq: '4',
    }));
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
      now: () => 1_000,
    });
    expect(outcome).toEqual({
      fetched: 2,
      caughtUp: 0,
      failed: 0,
      unavailable: false,
    });
    expect(fetchPage.mock.calls.map(([input]) => input.channelId)).toEqual([
      'a',
      'b',
    ]);
    expect(host.commits.map((commit) => commit.touchedAtMs)).toEqual([
      1_000, 1_000,
    ]);
  });

  it('replays changes for a channel the device holds, without a page fetch', async () => {
    const host = fakeHost(() => devicePage([], { seq: '3' }));
    const fetchPage = vi.fn();
    const fetchChanges = vi.fn(async () => ({
      resetRequired: false,
      seq: '3',
      hasMore: false,
      messages: [],
      activities: [],
      removedIds: [],
    }));
    const outcome = await runChannelPrewarm(host, ['a'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
      fetchChanges,
    });
    expect(outcome.caughtUp).toBe(1);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(fetchChanges).toHaveBeenCalledTimes(1);
  });

  it('carries on past a channel that fails', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        entries: [],
        olderCursor: null,
        newerCursor: null,
        seq: '1',
      });
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
    });
    expect(outcome).toMatchObject({ fetched: 1, failed: 1 });
  });

  it('stops on a host that cannot serve channels', async () => {
    const host = fakeHost(() => ({ kind: 'unsupported' }));
    const fetchPage = vi.fn();
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
    });
    expect(outcome.unavailable).toBe(true);
    expect(host.reads).toHaveLength(1);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does nothing once aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const host = fakeHost(() => devicePage([], { covered: false }));
    await runChannelPrewarm(host, ['a'], { signal: abort.signal, delayMs: 0 });
    expect(host.reads).toEqual([]);
  });
});

describe('evictIdleChannels', () => {
  it('evicts channels untouched for thirty days until none remain', async () => {
    const results = [
      { channelIds: ['a', 'b'], hasMore: true },
      { channelIds: ['c'], hasMore: false },
    ];
    const channelTimelineEvict = vi.fn(async () => ({
      kind: 'evicted' as const,
      revision: '1' as never,
      changed: [],
      ...(results.shift() ?? { channelIds: [], hasMore: false }),
    }));
    const evicted = await evictIdleChannels(
      { channelTimelineEvict },
      { signal: new AbortController().signal, now: () => 5_000_000_000 }
    );
    expect(evicted).toBe(3);
    expect(channelTimelineEvict).toHaveBeenCalledTimes(2);
    expect(channelTimelineEvict).toHaveBeenCalledWith({
      touchedBeforeMs: 5_000_000_000 - CHANNEL_EVICTION_AGE_MS,
      maxChannels: 200,
    });
  });

  it('stops on a host without eviction', async () => {
    const channelTimelineEvict = vi.fn(async () => ({
      kind: 'unsupported' as const,
    }));
    expect(
      await evictIdleChannels(
        { channelTimelineEvict },
        { signal: new AbortController().signal }
      )
    ).toBe(0);
  });
});
