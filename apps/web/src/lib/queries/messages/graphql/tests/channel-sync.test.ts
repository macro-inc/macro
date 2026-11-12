/**
 * @vitest-environment jsdom
 */

import type { CacheHost } from '@graphql-cache/host/types';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLatestChannelPage: vi.fn(),
  fetchChannelPage: vi.fn(),
  fetchChannelChanges: vi.fn(),
  readCachedLatestPage: vi.fn(),
  writeCachedLatestPage: vi.fn(),
  channelCacheHost: vi.fn(),
}));

let testQueryClient: QueryClient;

vi.mock('../../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('../source', () => mocks);
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('../../subscription', () => ({ useMessageSubscription: () => {} }));

import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
  messageTimelineQueryOptions,
} from '../../timeline';
import {
  channelSyncSeq,
  loadChannelTimelinePage,
  resetChannelSync,
} from '../channel-sync';
import { entryToGraphql } from '../convert';
import { CHANNEL, ids, messageEntry, page, timeline } from './fixtures';

const HOST = {} as CacheHost;
const LATEST_KEY = getMessageTimelineQueryKey(CHANNEL, null);

function changes(
  seq: number,
  overrides: Partial<{
    reset: boolean;
    hasMore: boolean;
    entries: unknown[];
    removed: string[];
  }> = {}
) {
  return {
    reset: false,
    seq,
    hasMore: false,
    entries: [],
    replies: [],
    activities: [],
    removed: [],
    ...overrides,
  };
}

function loadedIds() {
  return ids(testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY));
}

/** Open the channel the way the query does: load the page, then hold it. */
async function open() {
  if (testQueryClient.getQueryState(LATEST_KEY)) {
    await testQueryClient.refetchQueries({ queryKey: LATEST_KEY });
  } else {
    await testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(CHANNEL, null),
      retry: false,
    });
  }
}

/** The catch-up an open starts runs behind it; wait for what it leaves. */
function caughtUpTo(seq: number) {
  return vi.waitFor(() => expect(channelSyncSeq(CHANNEL.id)).toBe(seq));
}

function readAgain() {
  return vi.waitFor(() =>
    expect(testQueryClient.getQueryState(LATEST_KEY)?.isInvalidated).toBe(true)
  );
}

beforeEach(() => {
  testQueryClient = new QueryClient();
  resetChannelSync();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.writeCachedLatestPage.mockResolvedValue(undefined);
  mocks.channelCacheHost.mockReturnValue(HOST);
});

afterEach(() => {
  vi.useRealTimers();
  testQueryClient.clear();
});

describe('opening a channel', () => {
  it('reads the server page on a cache miss and tracks its sequence number', async () => {
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    expect(loadedIds()).toEqual([['m1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(7);
    expect(mocks.fetchChannelChanges).not.toHaveBeenCalled();
  });

  it('opens from the cached page and applies the changes after it', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(
      changes(9, {
        entries: [
          entryToGraphql(messageEntry('m3', 3)),
          entryToGraphql(messageEntry('m1', 1, { content: 'edited' })),
        ],
        removed: ['m2'],
      })
    );
    await open();
    expect(mocks.fetchLatestChannelPage).not.toHaveBeenCalled();
    await caughtUpTo(9);
    expect(mocks.fetchChannelChanges).toHaveBeenCalledWith(CHANNEL.id, 7);
    expect(loadedIds()).toEqual([['m3', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(9);
  });

  it('reads every page of changes', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges
      .mockResolvedValueOnce(
        changes(2, {
          hasMore: true,
          entries: [entryToGraphql(messageEntry('m2', 2))],
        })
      )
      .mockResolvedValueOnce(
        changes(3, { entries: [entryToGraphql(messageEntry('m3', 3))] })
      );
    await open();
    await caughtUpTo(3);
    expect(mocks.fetchChannelChanges.mock.calls).toEqual([
      [CHANNEL.id, 1],
      [CHANNEL.id, 2],
    ]);
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
  });

  it('reads the server page again when the cached page is past the reset limit', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(50, { reset: true }));
    await open();
    await readAgain();
    expect(loadedIds()).toEqual([['m1']]);

    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 50,
      userId: 'user',
      page: page([messageEntry('m9', 9)]),
    });
    await open();
    expect(mocks.readCachedLatestPage).toHaveBeenCalledTimes(1);
    expect(loadedIds()).toEqual([['m9']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(50);
  });

  it('does not apply changes read from before a newer page', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    let release: (value: unknown) => void = () => {};
    mocks.fetchChannelChanges
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(changes(5));
    await open();
    await vi.waitFor(() =>
      expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1)
    );
    // The timeline is read again from the server while changes are in flight.
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 5,
      userId: 'user',
      page: page([messageEntry('m1', 1, { content: 'newer' })]),
    });
    await open();
    release(
      changes(3, {
        entries: [entryToGraphql(messageEntry('m1', 1, { content: 'older' }))],
      })
    );
    await vi.waitFor(() =>
      expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(2)
    );
    const entry =
      testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY)?.pages[0]
        .entries[0];
    expect(entry?.type === 'message' && entry.message.content).toBe('newer');
    expect(mocks.fetchChannelChanges).toHaveBeenLastCalledWith(CHANNEL.id, 5);
    expect(channelSyncSeq(CHANNEL.id)).toBe(5);
  });

  it('reads the server page when changes cannot be read', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockRejectedValue(new Error('offline'));
    await open();
    await readAgain();
  });

  it('treats an unreadable cache as a miss', async () => {
    mocks.readCachedLatestPage.mockRejectedValue(new Error('closed'));
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 2,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    expect(loadedIds()).toEqual([['m1']]);
  });
});

describe('opening a channel while the cache is still starting', () => {
  const CACHED = {
    seq: 7,
    userId: 'user',
    page: page([messageEntry('m1', 1)]),
  };
  const SERVER = {
    seq: 9,
    userId: 'user',
    page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
  };

  // Longer than the head start of a cache that has answered before, which
  // the shared test host has by the time these run.
  const SLOW = 2_500;

  function after<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
  }

  it('shows the server page when it arrives first', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockReturnValue(after(100, SERVER));
    const opened = open();
    await vi.advanceTimersByTimeAsync(2_200);
    await opened;
    expect(loadedIds()).toEqual([['m2', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(9);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.fetchChannelChanges).not.toHaveBeenCalled();
  });

  it('opens from the cached page when it answers before the server', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockImplementation(
      (_id: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    mocks.fetchChannelChanges.mockResolvedValue(changes(7));
    const opened = open();
    await vi.advanceTimersByTimeAsync(3_000);
    await opened;
    expect(loadedIds()).toEqual([['m1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(7);
    expect(mocks.fetchChannelChanges).toHaveBeenCalledWith(CHANNEL.id, 7);
    // The server read it no longer waits for is cancelled.
    const [, signal] = mocks.fetchLatestChannelPage.mock.calls[0];
    expect(signal.aborted).toBe(true);
  });

  it('opens from the cached page when the server cannot be reached', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockRejectedValue(new Error('offline'));
    mocks.fetchChannelChanges.mockRejectedValue(new Error('offline'));
    const opened = open();
    await vi.advanceTimersByTimeAsync(3_000);
    await opened;
    expect(loadedIds()).toEqual([['m1']]);
  });

  it('fails when neither the cache nor the server has the page', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, undefined));
    mocks.fetchLatestChannelPage.mockRejectedValue(new Error('offline'));
    const opened = open().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await opened).toBeInstanceOf(Error);
  });
});

describe('pages other than the latest', () => {
  it('reads cursor pages and around pages from the server', async () => {
    mocks.fetchChannelPage.mockResolvedValue({ seq: 1, page: page([]) });
    const cursor = { created_at: '2026-11-12T10:00:00Z', id: 'm1' };
    await loadChannelTimelinePage(
      HOST,
      CHANNEL,
      { next_cursor: cursor, previous_cursor: null },
      null
    );
    await loadChannelTimelinePage(
      HOST,
      CHANNEL,
      { next_cursor: null, previous_cursor: cursor },
      null
    );
    await loadChannelTimelinePage(HOST, CHANNEL, null, 'm5');
    expect(mocks.fetchChannelPage.mock.calls).toEqual([
      [CHANNEL.id, { cursor, direction: 'older' }, 100, undefined],
      [CHANNEL.id, { cursor, direction: 'newer' }, 100, undefined],
      [CHANNEL.id, { around: 'm5' }, 50, undefined],
    ]);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
  });
});

describe('writing the page back', () => {
  it('stores the caught-up latest page with its sequence number', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(
      changes(2, { entries: [entryToGraphql(messageEntry('m2', 2))] })
    );
    await open();
    await caughtUpTo(2);
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
    await vi.waitFor(
      () => expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(1),
      { timeout: 3_000 }
    );
    const [, channelId, written] = mocks.writeCachedLatestPage.mock.calls[0];
    expect(channelId).toBe(CHANNEL.id);
    expect(written.seq).toBe(2);
    expect(written.userId).toBe('user');
    expect(ids(timeline(written.page))).toEqual([['m2', 'm1']]);
  });
});
