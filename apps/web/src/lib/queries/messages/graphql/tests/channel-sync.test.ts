/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Message, MessageThread } from '@service-storage/messages';
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/solid-query';
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

import { getThreadRepliesQueryKey } from '../../thread-replies';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
  messageTimelineQueryOptions,
} from '../../timeline';
import {
  catchUpChannel,
  channelSyncSeq,
  loadChannelTimelinePage,
  resetChannelSync,
} from '../channel-sync';
import { entryToGraphql } from '../convert';
import {
  CHANNEL,
  ids,
  messageEntry,
  page,
  reply,
  root,
  timeline,
} from './fixtures';

const HOST = {} as CacheHost;
const LATEST_KEY = getMessageTimelineQueryKey(CHANNEL, null);

function changes(
  seq: number,
  overrides: Partial<{
    reset: boolean;
    hasMore: boolean;
    entries: unknown[];
    replies: unknown[];
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

/** A reply as the server's changes carry it. */
function replyToGraphql(message: Message) {
  const parentRoot = root('m1', 1);
  const entry = entryToGraphql({
    type: 'message',
    message: {
      ...parentRoot,
      thread: { ...parentRoot.thread, preview: [message] },
    },
  });
  if (entry.__typename !== 'GraphqlChannelMessage' || !entry.thread?.preview[0])
    throw new Error('expected a message with a preview');
  return entry.thread.preview[0];
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
  // Most cases open from the cache: the server read the open races it with
  // stays unanswered until the cached page wins and cancels it.
  mocks.fetchLatestChannelPage.mockImplementation(
    (_id: string, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
  );
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

  it('writes the server page to the cache once it is loaded', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    const [, channelId, written] = mocks.writeCachedLatestPage.mock.calls[0];
    expect(channelId).toBe(CHANNEL.id);
    expect(written.seq).toBe(7);
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
    // The server read the open raced the cache with is cancelled.
    const [, signal] = mocks.fetchLatestChannelPage.mock.calls[0];
    expect(signal.aborted).toBe(true);
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
    // A macrotask later the catch-up has finished with the answer it got.
    await new Promise((resolve) => setTimeout(resolve));
    const entry =
      testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY)?.pages[0]
        .entries[0];
    expect(entry?.type === 'message' && entry.message.content).toBe('newer');
    // The page read is already past what the changes read saw.
    expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1);
    expect(channelSyncSeq(CHANNEL.id)).toBe(5);
  });

  it('asks again when the timeline moved but is still behind the server', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    let release: (value: unknown) => void = () => {};
    mocks.fetchChannelChanges
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(
        changes(8, { entries: [entryToGraphql(messageEntry('m3', 3))] })
      );
    await open();
    await vi.waitFor(() =>
      expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1)
    );
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 5,
      userId: 'user',
      page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
    });
    await open();
    release(changes(8, { entries: [entryToGraphql(messageEntry('m3', 3))] }));
    await caughtUpTo(8);
    expect(mocks.fetchChannelChanges).toHaveBeenLastCalledWith(CHANNEL.id, 5);
    expect(loadedIds()).toEqual([['m3', 'm2', 'm1']]);
  });

  it('gives up the number while the page is read again', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(0, { reset: true }));
    const newer = new Promise(() => {});
    mocks.fetchLatestChannelPage.mockReturnValue(newer);
    await open();
    await readAgain();
    // Rows in doubt are not caught up or written back under their old number.
    expect(channelSyncSeq(CHANNEL.id)).toBeUndefined();
    expect(loadedIds()).toEqual([['m1']]);
  });

  it('drops the cached page and the rows when the server refuses the changes', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    const refusal = new ThrownResultError([
      { code: 'FORBIDDEN', message: 'forbidden' },
    ]);
    mocks.fetchChannelChanges.mockRejectedValue(refusal);
    await open();
    mocks.fetchLatestChannelPage.mockRejectedValue(refusal);
    await vi.waitFor(() => expect(loadedIds()).toEqual([]));
    await vi.waitFor(() =>
      expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(1)
    );
    const [, , written] = mocks.writeCachedLatestPage.mock.calls[0];
    expect(written.page.entries).toEqual([]);
  });

  it('drops the rows when the server refuses a timeline being read again', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(1));
    await open();
    await caughtUpTo(1);
    mocks.fetchLatestChannelPage.mockRejectedValue(
      new ThrownResultError([{ code: 'FORBIDDEN', message: 'forbidden' }])
    );
    await open();
    await vi.waitFor(() => expect(loadedIds()).toEqual([]));
    await vi.waitFor(() =>
      expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(1)
    );
    const [, , written] = mocks.writeCachedLatestPage.mock.calls[0];
    expect(written.page.entries).toEqual([]);
  });

  it('reads a thread again whose first read a changed reply arrived during', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    const threadKey = getThreadRepliesQueryKey(CHANNEL, 'm1');
    const first = Promise.withResolvers<MessageThread>();
    const read = vi.fn<() => Promise<MessageThread>>();
    read.mockReturnValueOnce(first.promise);
    const { state, thread: _summary, ...message } = root('m1', 1);
    const thread: MessageThread = { root: message, state, replies: [] };
    read.mockResolvedValue(thread);
    const reading = testQueryClient.fetchQuery({
      queryKey: threadKey,
      queryFn: read,
    });
    const unsubscribe = new QueryObserver(testQueryClient, {
      queryKey: threadKey,
      queryFn: read,
    }).subscribe(() => {});
    mocks.fetchChannelChanges.mockResolvedValue(
      changes(2, { replies: [replyToGraphql(reply('r1', 'm1', 2))] })
    );
    await open();
    await caughtUpTo(2);
    first.resolve(thread);
    await reading;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    unsubscribe();
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

  // A cache read held up by a busy engine.
  const SLOW = 2_500;

  function after<T>(ms: number, value: T): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
  }

  it('shows the server page when it arrives first', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockReturnValue(after(100, SERVER));
    const opened = open();
    await vi.advanceTimersByTimeAsync(200);
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

  it('does not wait for a slow cache before asking the server', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockResolvedValue(SERVER);
    // No timer has to pass: the open never waits on the cache alone.
    await open();
    expect(loadedIds()).toEqual([['m2', 'm1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(9);
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

  it('does not show the cached page when the server refuses the read', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockReturnValue(after(SLOW, CACHED));
    mocks.fetchLatestChannelPage.mockRejectedValue(
      new ThrownResultError([{ code: 'FORBIDDEN', message: 'not a member' }])
    );
    const opened = open().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await opened).toBeInstanceOf(ThrownResultError);
    expect(loadedIds()).toEqual([]);
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

describe('the sequence number stays with the rows it describes', () => {
  function held<T>() {
    let release: (value: T) => void = () => {};
    const promise = new Promise<T>((resolve) => (release = resolve));
    return { promise, release };
  }

  /** A channel on screen: the timeline has an observer. */
  function observe() {
    const observer = new InfiniteQueryObserver(testQueryClient, {
      ...messageTimelineQueryOptions(CHANNEL, null),
      retry: false,
    });
    return observer.subscribe(() => {});
  }

  it('keeps caught-up rows when an older page was being read', async () => {
    const cursor = { created_at: '2026-11-12T10:01:00Z', id: 'm1' };
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: { ...page([messageEntry('m1', 1)]), next_cursor: cursor },
    });
    const changed = held<ReturnType<typeof changes>>();
    mocks.fetchChannelChanges.mockReturnValueOnce(changed.promise);
    const older = held<{ seq: number; page: ReturnType<typeof page> }>();
    mocks.fetchChannelPage.mockReturnValueOnce(older.promise);
    mocks.fetchChannelPage.mockResolvedValue({
      seq: 2,
      page: page([messageEntry('m0', 0)]),
    });
    const unsubscribe = observe();
    await vi.waitFor(() =>
      expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1)
    );
    // The older page's read starts from a timeline without the new message.
    const paging = testQueryClient.fetchInfiniteQuery({
      ...messageTimelineQueryOptions(CHANNEL, null),
      retry: false,
    });
    const query = testQueryClient
      .getQueryCache()
      .find({ queryKey: LATEST_KEY });
    const more = query?.fetch(undefined, {
      meta: { fetchMore: { direction: 'forward' } },
    });
    await vi.waitFor(() =>
      expect(mocks.fetchChannelPage).toHaveBeenCalledTimes(1)
    );
    changed.release(
      changes(2, { entries: [entryToGraphql(messageEntry('m2', 2))] })
    );
    await caughtUpTo(2);
    older.release({ seq: 1, page: page([messageEntry('m0', 0)]) });
    await Promise.allSettled([paging, more]);
    await vi.waitFor(() => expect(loadedIds()).toEqual([['m2', 'm1'], ['m0']]));
    expect(channelSyncSeq(CHANNEL.id)).toBe(2);
    unsubscribe();
  });

  it('runs a catch-up asked for while a page read was being restarted', async () => {
    const cursor = { created_at: '2026-11-12T10:01:00Z', id: 'm1' };
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: { ...page([messageEntry('m1', 1)]), next_cursor: cursor },
    });
    const changed = held<ReturnType<typeof changes>>();
    mocks.fetchChannelChanges
      .mockReturnValueOnce(changed.promise)
      .mockResolvedValueOnce(
        changes(3, { entries: [entryToGraphql(messageEntry('m3', 3))] })
      );
    const older = held<{ seq: number; page: ReturnType<typeof page> }>();
    mocks.fetchChannelPage.mockReturnValueOnce(older.promise);
    const restarted = held<{ seq: number; page: ReturnType<typeof page> }>();
    mocks.fetchChannelPage.mockReturnValueOnce(restarted.promise);
    const unsubscribe = observe();
    await vi.waitFor(() =>
      expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1)
    );
    const query = testQueryClient
      .getQueryCache()
      .find({ queryKey: LATEST_KEY });
    const more = query?.fetch(undefined, {
      meta: { fetchMore: { direction: 'forward' } },
    });
    await vi.waitFor(() =>
      expect(mocks.fetchChannelPage).toHaveBeenCalledTimes(1)
    );
    changed.release(
      changes(2, { entries: [entryToGraphql(messageEntry('m2', 2))] })
    );
    // The catch-up is now waiting on the restarted page read.
    await vi.waitFor(() =>
      expect(mocks.fetchChannelPage).toHaveBeenCalledTimes(2)
    );
    const again = catchUpChannel(HOST, CHANNEL);
    restarted.release({ seq: 2, page: page([messageEntry('m0', 0)]) });
    older.release({ seq: 1, page: page([messageEntry('m0', 0)]) });
    await Promise.allSettled([more, again]);
    await caughtUpTo(3);
    expect(loadedIds()[0]).toEqual(['m3', 'm2', 'm1']);
    unsubscribe();
  });

  it('keeps the old number when a newer page read is cancelled', async () => {
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValueOnce({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    const newer = held<unknown>();
    mocks.fetchLatestChannelPage.mockReturnValueOnce(newer.promise);
    const refetch = testQueryClient.refetchQueries({ queryKey: LATEST_KEY });
    await vi.waitFor(() =>
      expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(2)
    );
    await testQueryClient.cancelQueries({ queryKey: LATEST_KEY });
    newer.release({
      seq: 9,
      userId: 'user',
      page: page([messageEntry('m2', 2), messageEntry('m1', 1)]),
    });
    await refetch;
    expect(loadedIds()).toEqual([['m1']]);
    expect(channelSyncSeq(CHANNEL.id)).toBe(7);
  });

  it('puts the number back with the rows a rollback restores', async () => {
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    const snapshot =
      testQueryClient.getQueryData<MessageTimelineData>(LATEST_KEY);
    testQueryClient.setQueryData<MessageTimelineData>(
      LATEST_KEY,
      (data) =>
        data && {
          ...data,
          pages: [{ ...page([messageEntry('m2', 2)]), channel_seq: 8 }],
        }
    );
    expect(channelSyncSeq(CHANNEL.id)).toBe(8);
    testQueryClient.setQueryData(LATEST_KEY, snapshot);
    expect(channelSyncSeq(CHANNEL.id)).toBe(7);
  });

  it('updates the root an open thread shows', async () => {
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    const { state, thread: _summary, ...message } = root('m1', 1);
    const threadKey = getThreadRepliesQueryKey(CHANNEL, 'm1');
    testQueryClient.setQueryData<MessageThread>(threadKey, {
      root: message,
      state,
      replies: [],
    });
    mocks.fetchChannelChanges.mockResolvedValue(
      changes(2, {
        entries: [entryToGraphql(messageEntry('m1', 1, { content: 'edited' }))],
      })
    );
    await open();
    await caughtUpTo(2);
    expect(
      testQueryClient.getQueryData<MessageThread>(threadKey)?.root.content
    ).toBe('edited');
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
  it('does not write to a cache that is no longer the session cache', async () => {
    vi.useFakeTimers();
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await open();
    mocks.channelCacheHost.mockReturnValue(undefined);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
  });

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
