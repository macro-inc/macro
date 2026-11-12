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

/** The viewer's loaded channel list and activity, as the shell holds them. */
function knownChannels(opened: Record<string, string | null>) {
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
  it('takes every unread channel, then the 20 most recently opened, once each', () => {
    const channelIds = Array.from({ length: 25 }, (_, index) => `c${index}`);
    const lastOpened = new Map(
      channelIds.map((channelId, index) => [channelId, index])
    );
    const chosen = chooseChannelsToPrewarm({
      unread: ['u1', 'c24'],
      channelIds,
      lastOpened,
      isLoaded: (channelId) => channelId === 'c23',
    });
    expect(chosen).toEqual([
      'u1',
      'c24',
      ...Array.from({ length: 18 }, (_, index) => `c${22 - index}`),
    ]);
  });

  it('ranks only channels in the list, and leaves out unopened ones', () => {
    const chosen = chooseChannelsToPrewarm({
      unread: [],
      channelIds: ['a', 'b', 'never'],
      lastOpened: new Map([
        ['left', 30],
        ['a', 10],
        ['b', 20],
      ]),
      isLoaded: () => false,
    });
    expect(chosen).toEqual(['b', 'a']);
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
    await maintainChannelCache([]);
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
    await maintainChannelCache([]);
    expect(mocks.fetchChannelChanges.mock.calls).toEqual([
      ['a', 7],
      ['a', 8],
    ]);
    expect(mocks.fetchLatestChannelPage).not.toHaveBeenCalled();
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 9, ids: ['m2'] });
  });

  it('writes nothing for a cached page that is already current', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockResolvedValue({
      seq: 7,
      userId: 'user',
      page: page([messageEntry('m1', 1)]),
    });
    mocks.fetchChannelChanges.mockResolvedValue(changes(7));
    await maintainChannelCache([]);
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
    await maintainChannelCache([]);
    expect(writtenIds()).toEqual({ channelId: 'a', seq: 40, ids: ['m9'] });
  });

  it('reads the page again past the catch-up page limit', async () => {
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
    await maintainChannelCache([]);
    expect(mocks.fetchChannelChanges).toHaveBeenCalledTimes(20);
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
      await maintainChannelCache([]);
      expect(mocks[failing]).toHaveBeenCalled();
      expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
    }
  );

  it('neither reads nor writes when the cache cannot read the page', async () => {
    knownChannels({ a: daysAgo(1) });
    mocks.readCachedLatestPage.mockRejectedValue(new Error('engine busy'));
    await maintainChannelCache([]);
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
    await maintainChannelCache(['a']);
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
    const run = maintainChannelCache([]);
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
    await maintainChannelCache(['a']);
    await maintainChannelCache(['a']);
    expect(mocks.writeCachedLatestPage).toHaveBeenCalledOnce();
    await maintainChannelCache([]);
    await maintainChannelCache(['a']);
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
    await maintainChannelCache(['unreadStale']);
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
    await maintainChannelCache([]);
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
    await maintainChannelCache([]);
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
    // Once the lists are read again, the unopened channel's page goes.
    knownChannels({ never: null });
    await maintainChannelCache([]);
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
    await maintainChannelCache([]);
    expect(writtenIds().channelId).toBe('stale');
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('looks again only a day later', async () => {
    knownChannels({ never: null });
    await maintainChannelCache([]);
    await maintainChannelCache([]);
    expect(mocks.readCachedPageRecords).toHaveBeenCalledOnce();
  });
});

describe('when nothing runs', () => {
  it('does nothing with the channel cache off', async () => {
    mocks.channelCacheHost.mockReturnValue(undefined);
    knownChannels({ a: daysAgo(1), stale: daysAgo(90) });
    await maintainChannelCache(['a']);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
    expect(mocks.writeCachedLatestPage).not.toHaveBeenCalled();
  });

  it('does nothing for a hidden tab', async () => {
    visibility = 'hidden';
    knownChannels({ a: daysAgo(1), stale: daysAgo(90) });
    await maintainChannelCache(['a']);
    expect(mocks.readCachedLatestPage).not.toHaveBeenCalled();
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
  });

  it('stops between steps once the tab is hidden', async () => {
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
    await maintainChannelCache([]);
    expect(mocks.readCachedLatestPage).toHaveBeenCalledTimes(3);
    expect(mocks.readCachedPageRecords).not.toHaveBeenCalled();
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
      useChannelCachePrewarm(() => []);
      return dispose;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.channelCacheHost).not.toHaveBeenCalled();
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.readCachedLatestPage).toHaveBeenCalledWith(
      HOST,
      'a',
      'background'
    );
    dispose();
  });
});
