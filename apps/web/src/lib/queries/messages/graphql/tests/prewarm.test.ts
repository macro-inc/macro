/**
 * @vitest-environment jsdom
 */

import type { CacheHost } from '@graphql-cache/host/types';
import { QueryClient } from '@tanstack/solid-query';
import { subDays } from 'date-fns';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLatestChannelPage: vi.fn(),
  fetchChannelPage: vi.fn(),
  fetchChannelChanges: vi.fn(),
  readCachedLatestPage: vi.fn(),
  readCachedPageRecords: vi.fn(),
  writeCachedLatestPage: vi.fn(),
  channelCacheHost: vi.fn(),
  deleteRecords: vi.fn(),
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
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [], activity: () => [] }),
}));

import { authKeys } from '../../../auth/keys';
import { channelKeys } from '../../../channel/keys';
import { getMessageTimelineQueryKey } from '../../timeline';
import { entryToGraphql } from '../convert';
import {
  chooseChannelsToPrewarm,
  maintainChannelCache,
  resetChannelPrewarm,
  useChannelCachePrewarm,
} from '../prewarm';
import { messageEntry, page } from './fixtures';

const HOST: Pick<CacheHost, 'deleteRecords'> = {
  deleteRecords: mocks.deleteRecords,
};
const NOW = new Date();

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function daysAgo(days: number): string {
  return subDays(NOW, days).toISOString();
}

/** The opened channels of the last `knownChannels`, most recent first. */
let recentlyOpened: string[] = [];

/** A run with the unread channels and, unless given, the opened ones. */
function maintain(unread: string[] = [], recent: string[] = recentlyOpened) {
  return maintainChannelCache({ unread, recent });
}

/** The viewer's loaded channel list and activity, as the shell holds them. */
function knownChannels(opened: Record<string, string | null>) {
  recentlyOpened = Object.entries(opened)
    .flatMap(([id, viewed_at]) => (viewed_at ? [{ id, viewed_at }] : []))
    .sort((a, b) => b.viewed_at.localeCompare(a.viewed_at))
    .map(({ id }) => id);
  testQueryClient.setQueryData(
    channelKeys.listChannels('user').queryKey,
    Object.entries(opened).map(([id, viewed_at]) => ({ id, viewed_at }))
  );
  testQueryClient.setQueryData(
    channelKeys.activity('user').queryKey,
    Object.entries(opened).map(([channel_id, viewed_at]) => ({
      channel_id,
      viewed_at,
    }))
  );
}

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

function writtenIds(call = 0) {
  const [, channelId, written] = mocks.writeCachedLatestPage.mock.calls[call];
  return {
    channelId,
    seq: written.seq,
    ids: written.page.entries.map(
      (entry: { type: string; message?: { id: string } }) => entry.message?.id
    ),
  };
}

beforeEach(() => {
  testQueryClient = new QueryClient();
  testQueryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: 'user',
    authenticated: true,
  });
  resetChannelPrewarm();
  recentlyOpened = [];
  // The pause between two channels would make each run take seconds.
  const realSetTimeout = setTimeout;
  vi.stubGlobal('setTimeout', (callback: () => void, delay = 0) =>
    realSetTimeout(callback, delay > 1_000 ? delay : 0)
  );
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.channelCacheHost.mockReturnValue(HOST);
  mocks.writeCachedLatestPage.mockResolvedValue(undefined);
  mocks.readCachedPageRecords.mockResolvedValue(new Map());
  mocks.deleteRecords.mockResolvedValue({ affected: [] });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility
  );
  vi.stubGlobal('requestIdleCallback', (callback: () => void) =>
    setTimeout(callback, 0)
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  testQueryClient.clear();
});

describe('choosing channels to warm', () => {
  it('takes the first 40 unread, then the first 20 recently opened, once each', () => {
    const unread = Array.from({ length: 300 }, (_, index) => `u${index}`);
    const recent = Array.from({ length: 25 }, (_, index) => `c${index}`);
    const chosen = chooseChannelsToPrewarm({
      unread,
      recent: ['u1', ...recent],
      isLoaded: (channelId) => channelId === 'c3',
    });
    expect(chosen).toEqual([
      ...unread.slice(0, 40),
      ...recent.slice(0, 19).filter((channelId) => channelId !== 'c3'),
    ]);
  });

  it('keeps the order the server gave each list', () => {
    const chosen = chooseChannelsToPrewarm({
      unread: ['z', 'a'],
      recent: ['m', 'b'],
      isLoaded: () => false,
    });
    expect(chosen).toEqual(['z', 'a', 'm', 'b']);
  });
});

describe('warming a channel', () => {
  it('writes the server page for a channel the cache holds no page for', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 5,
      userId: 'user',
      page: page(
        Array.from({ length: 120 }, (_, index) =>
          messageEntry(`m${index}`, 59 - (index % 60))
        )
      ),
    });
    await maintain();
    expect(mocks.readCachedLatestPage).toHaveBeenCalledWith(
      HOST,
      'a',
      'background'
    );
    expect(mocks.fetchChannelChanges).not.toHaveBeenCalled();
    const written = writtenIds();
    expect(written.channelId).toBe('a');
    expect(written.seq).toBe(5);
    expect(written.ids).toHaveLength(100);
  });

  it('catches a cached page up from its number and writes it with the new one', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges
      .mockResolvedValueOnce(
        changes(8, {
          hasMore: true,
          entries: [entryToGraphql(messageEntry('m2', 2))],
        })
      )
      .mockResolvedValueOnce(changes(9, { removed: ['m1'] }));
    await maintain();
    expect(mocks.fetchChannelChanges.mock.calls).toEqual([
      ['a', 7],
      ['a', 8],
    ]);
    expect(mocks.fetchLatestChannelPage).not.toHaveBeenCalled();
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 9, ids: ['m2'] });
  });

  it('reads the whole page for a channel whose cached page was emptied', async () => {
    knownChannels({ a: daysAgo(1) });
    // What a refused read leaves: no rows under the old number.
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([]),
    });
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 12,
      userId: 'user',
      page: page([messageEntry('m5', 5)]),
    });
    await maintain();
    expect(mocks.fetchChannelChanges).not.toHaveBeenCalled();
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 12, ids: ['m5'] });
  });

  it('writes nothing for a cached page that is already current', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(7));
    await maintain();
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
  });

  it('reads the page again on a reset', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(0, { reset: true }));
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 40,
      userId: 'user',
      page: page([messageEntry('m9', 9)]),
    });
    await maintain();
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 40, ids: ['m9'] });
  });

  it('reads the page again past two change pages', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    let seq = 1;
    mocks.fetchChannelChanges.mockImplementation(async () => {
      seq += 1;
      return changes(seq, { hasMore: true });
    });
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 99,
      userId: 'user',
      page: page([messageEntry('m9', 9)]),
    });
    await maintain();
    expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(2);
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 99, ids: ['m9'] });
  });

  it.each([
    ['the changes', 'fetchChannelChanges'],
    ['the server page', 'fetchLatestChannelPage'],
  ] as const)(
    'leaves the cached page as it was when %s cannot be read',
    async (_, failing) => {
      knownChannels({ a: daysAgo(1) });
      mocks.readCachedLatestPage.mockResolvedValue(
        failing === 'fetchChannelChanges'
          ? { seq: 7, userId: 'user', page: page([messageEntry('m1', 1)]) }
          : undefined
      );
      mocks[failing].mockRejectedValue(new TypeError('Failed to fetch'));
      await maintain();
      expect(mocks[failing]).toHaveBeenCalled();
      expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
    }
  );

  it('gives up on a server read that never answers and warms the next channel', async () => {
    // Every wait elapses at once, the read's deadline included.
    const realSetTimeout = setTimeout;
    vi.stubGlobal('setTimeout', (callback: () => void) =>
      realSetTimeout(callback, 0)
    );
    knownChannels({ a: daysAgo(1), b: daysAgo(2) });
    mocks.readCachedLatestPage.mockImplementation(
      async (_host: unknown, channelId: string) =>
        channelId === 'a'
          ? { seq: 7, userId: 'user', page: page([messageEntry('m1', 1)]) }
          : undefined
    );
    mocks.fetchChannelChanges.mockReturnValue(new Promise(() => {}));
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 3,
      userId: 'user',
      page: page([messageEntry('m2', 2)]),
    });
    await maintain();
    expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(1);
    expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(1);
    expect(writtenIds()).toEqual({ channelId: 'b', seq: 3, ids: ['m2'] });
  });

  it('neither reads nor writes when the cache cannot read the page', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockRejectedValue(new Error('engine busy'));
    await maintain();
    expect(mocks.fetchLatestChannelPage).not.toHaveBeenCalled();
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
  });

  it('never touches a channel whose timeline is loaded', async () => {
    knownChannels({ a: daysAgo(1), b: daysAgo(2) });
    testQueryClient.setQueryData(
      getMessageTimelineQueryKey({ type: 'channel', id: 'a' }, null),
      { pages: [page([])], pageParams: [null] }
    );
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await maintain(['a']);
    expect(mocks.readCachedLatestPage.mock.calls.map(([, id]) => id)).toEqual([
      'b',
    ]);
  });

  it('waits for a timeline read in flight before warming', async () => {
    vi.useFakeTimers();
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    const opening = Promise.withResolvers<null>();
    const open = testQueryClient.fetchQuery({
      queryKey: getMessageTimelineQueryKey({ type: 'channel', id: 'b' }, null),
      queryFn: () => opening.promise,
    });
    const run = maintain();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    opening.resolve(null);
    await open;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.readCachedLatestPage).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    await run;
  });

  it('warms a channel again only once it turns unread again', async () => {
    knownChannels({});
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    await maintain(['a']);
    await maintain(['a']);
    expect(mocks.writeCachedLatestPage).toHaveBeenCalledOnce();
    await maintain();
    await maintain(['a']);
    expect(mocks.writeCachedLatestPage).toHaveBeenCalledTimes(2);
  });
});

describe('evicting cached pages', () => {
  it('deletes the pages of channels not opened for 30 days and keeps the rest', async () => {
    // Twenty channels opened more recently fill the warmed set, which is kept.
    const recent = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`r${index}`, daysAgo(index)])
    );
    knownChannels({
      ...recent,
      boundary: daysAgo(29),
      stale: daysAgo(31),
      unreadStale: daysAgo(90),
      never: null,
    });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(1));
    mocks.readCachedPageRecords.mockImplementation(
      async (_host: unknown, channelIds: string[]) =>
        new Map(
          channelIds.map((channelId) => [
            channelId,
            [
              `GraphqlChannelMessages:${channelId}`,
              `GraphqlChannelMessage:${channelId}-row`,
            ],
          ])
        )
    );
    await maintain(['unreadStale']);
    const [, looked] = mocks.readCachedPageRecords.mock.calls[0];
    expect([...looked].sort()).toEqual(['never', 'stale']);
    expect(mocks.deleteRecords).toHaveBeenCalledOnce();
    expect([...mocks.deleteRecords.mock.calls[0][0]].sort()).toEqual([
      'GraphqlChannelMessage:never-row',
      'GraphqlChannelMessage:stale-row',
      'GraphqlChannelMessages:never',
      'GraphqlChannelMessages:stale',
    ]);
  });

  it('evicts nothing until both lists have loaded', async () => {
    testQueryClient.setQueryData(channelKeys.listChannels('user').queryKey, [
      { id: 'stale', viewed_at: daysAgo(90) },
    ]);
    await maintain();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('evicts nothing from lists restored from before the page loaded', async () => {
    const restored = { updatedAt: performance.timeOrigin - 1 };
    testQueryClient.setQueryData(
      channelKeys.listChannels('user').queryKey,
      [{ id: 'never', viewed_at: null }],
      restored
    );
    testQueryClient.setQueryData(
      channelKeys.activity('user').queryKey,
      [],
      restored
    );
    mocks.readCachedPageRecords.mockResolvedValue(
      new Map([['never', ['GraphqlChannelMessages:never']]])
    );
    await maintain();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
    // Once the lists are read again, the unopened channel's page goes.
    knownChannels({ never: null });
    await maintain();
    expect(mocks.deleteRecords).toHaveBeenCalledWith([
      'GraphqlChannelMessages:never',
    ]);
  });

  it('keeps the warmed channels whenever they were opened', async () => {
    knownChannels({ stale: daysAgo(90) });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([]),
    });
    await maintain();
    expect(writtenIds().channelId).toBe('stale');
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('looks again only a day later', async () => {
    knownChannels({ never: null });
    await maintain();
    await maintain();
    expect(mocks.readCachedPageRecords).toHaveBeenCalledOnce();
  });
});

describe('when nothing runs', () => {
  it('does nothing with the channel cache off', async () => {
    mocks.channelCacheHost.mockReturnValue(undefined);
    knownChannels({ a: daysAgo(1), stale: daysAgo(90) });
    await maintain(['a']);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
  });

  it('does nothing for a hidden tab', async () => {
    visibility = 'hidden';
    knownChannels({ a: daysAgo(1), stale: daysAgo(90) });
    await maintain(['a']);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
  });

  it('stops between channels once the tab is hidden', async () => {
    knownChannels({
      a: daysAgo(1),
      b: daysAgo(2),
      c: daysAgo(3),
      d: daysAgo(4),
    });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockImplementation(async () => {
      visibility = 'hidden';
      return { seq: 1, userId: 'user', page: page([]) };
    });
    await maintain();
    expect(mocks.readCachedLatestPage).toHaveBeenCalledOnce();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
  });

  it('the hook reads the queue once the cache is there, without a channel open', async () => {
    vi.useFakeTimers();
    knownChannels({});
    const inspectMutations = vi.fn().mockResolvedValue([]);
    const host = {
      ...HOST,
      inspectMutations,
      onMutationSettled: () => () => {},
      onCacheGenerationChanged: () => () => {},
    };
    // The flag has not loaded when the shell mounts.
    mocks.channelCacheHost.mockReturnValue(undefined);
    visibility = 'hidden';
    const dispose = createRoot((dispose) => {
      useChannelCachePrewarm(
        () => [],
        () => []
      );
      return dispose;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(inspectMutations).not.toHaveBeenCalled();

    mocks.channelCacheHost.mockReturnValue(host);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(inspectMutations).toHaveBeenCalledOnce();
    dispose();
  });

  it('the hook waits for a hidden tab to be shown', async () => {
    vi.useFakeTimers();
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([]),
    });
    visibility = 'hidden';
    const dispose = createRoot((dispose) => {
      useChannelCachePrewarm(
        () => [],
        () => ['a']
      );
      return dispose;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.readCachedLatestPage).toHaveBeenCalledWith(
      HOST,
      'a',
      'background'
    );
    dispose();
  });

  it('warms one channel at a time', async () => {
    knownChannels({ a: daysAgo(1), b: daysAgo(2), c: daysAgo(3) });
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    let inFlight = 0;
    let most = 0;
    mocks.fetchLatestChannelPage.mockImplementation(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { seq: 1, userId: 'user', page: page([]) };
    });
    await maintain();
    expect(mocks.fetchLatestChannelPage).toHaveBeenCalledTimes(3);
    expect(most).toBe(1);
  });

  it('the hook waits for the person to stop typing', async () => {
    // The pauses are what is measured here: put the real timer back.
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', (callback: () => void) =>
      setTimeout(callback, 0)
    );
    mocks.readCachedLatestPage.mockResolvedValue(undefined);
    mocks.fetchLatestChannelPage.mockResolvedValue({
      seq: 1,
      userId: 'user',
      page: page([]),
    });
    const dispose = createRoot((dispose) => {
      useChannelCachePrewarm(
        () => [],
        () => ['a']
      );
      return dispose;
    });
    await vi.advanceTimersByTimeAsync(2_400);
    document.dispatchEvent(new KeyboardEvent('keydown'));
    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.readCachedLatestPage).toHaveBeenCalledOnce();
    dispose();
  });
});
