import type { CacheHost } from '@graphql-cache/index';
import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markChannelCacheAnswered } from '../flag';
import {
  type ChannelServerPage,
  type FetchedChannelPage,
  loadChannelPage,
  resetPendingChannelPages,
  serverPageCoverage,
} from '../pages';
import { channelMessageKey, cursorFromSortKey } from '../sort-key';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlActivity,
  graphqlMessage,
  keyOf,
} from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));

const serverPage = (
  overrides: Partial<ChannelServerPage> = {}
): ChannelServerPage => ({
  entries: [],
  olderCursor: null,
  newerCursor: null,
  seq: '9',
  ...overrides,
});

const fetched = (page: ChannelServerPage): FetchedChannelPage => ({
  page,
  cached: Promise.resolve(),
});

/** A host that has answered a channel read before, as after startup. */
const startedHost: typeof fakeHost = (...args) => {
  const host = fakeHost(...args);
  markChannelCacheAnswered(host as unknown as CacheHost);
  return host;
};

describe('loadChannelPage', () => {
  beforeEach(() => resetPendingChannelPages());

  it('answers a channel known to be held from the device without a request', async () => {
    const newest = graphqlMessage(3);
    const joined = graphqlActivity(2);
    const oldest = graphqlMessage(1);
    const held = devicePage([newest, joined, oldest].map(keyOf), {
      olderCursor: oldest.sortKey,
    });
    const host = startedHost([held, held], {
      records: [newest, joined, oldest],
    });
    // The first open cannot know the device holds the channel, so it asks the
    // server too; the device answers first.
    const fetchPage = vi.fn(() => new Promise<FetchedChannelPage>(() => {}));
    const first = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );
    expect(first).toMatchObject({ source: 'device' });
    expect(fetchPage).toHaveBeenCalledTimes(1);

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(host.commits).toEqual([]);
    expect(loaded).toMatchObject({ source: 'device', storedSeq: '7' });
    if (typeof loaded === 'string') throw new Error('expected a page');
    expect(
      loaded.page.entries.map((entry) =>
        entry.type === 'activity' ? entry.activity.id : entry.message.id
      )
    ).toEqual([newest.id, joined.id, oldest.id]);
    expect(loaded.page.next_cursor).toEqual(cursorFromSortKey(oldest.sortKey));
    expect(loaded.page.previous_cursor).toBeNull();
  });

  it('fetches a stretch the device does not hold and records it', async () => {
    const newest = graphqlMessage(3);
    const oldest = graphqlMessage(1);
    const host = startedHost([devicePage([], { covered: false, seq: null })]);
    const fetchPage = vi.fn(async () =>
      fetched(
        serverPage({ entries: [newest, oldest], olderCursor: oldest.sortKey })
      )
    );

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage, now: () => 1234 }
    );

    expect(fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID, limit: 50 }),
      undefined
    );
    if (typeof loaded === 'string' || loaded.source !== 'server') {
      throw new Error('expected a server page');
    }
    expect(await loaded.stored).toBe('9');
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [{ start: oldest.sortKey, end: CHANNEL_TIMELINE_HEAD }],
        seq: { kind: 'lower', seq: '9' },
        touchedAtMs: 1234,
      },
    ]);
    expect(loaded).toMatchObject({ source: 'server', serverSeq: '9' });
  });

  it('fetches when a held key has no readable record', async () => {
    const message = graphqlMessage(1);
    const host = startedHost([devicePage([keyOf(message)])]);
    const fetchPage = vi.fn(async () =>
      fetched(serverPage({ entries: [message] }))
    );

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(loaded).toMatchObject({ source: 'server' });
  });

  it('asks the device for the page around a message by its record key', async () => {
    const target = graphqlMessage(5);
    const host = startedHost([devicePage([keyOf(target)])], {
      records: [target],
    });

    await loadChannelPage(host, {
      channelId: CHANNEL_ID,
      limit: 50,
      aroundMessageId: target.id,
    });

    expect(host.reads).toEqual([
      {
        channelId: CHANNEL_ID,
        limit: 50,
        around: channelMessageKey(target.id),
      },
    ]);
  });

  it('reports a native engine without channel timelines', async () => {
    const host = startedHost([{ kind: 'unsupported' }]);
    const fetchPage = vi.fn(() => new Promise<FetchedChannelPage>(() => {}));

    expect(
      await loadChannelPage(
        host,
        { channelId: CHANNEL_ID, limit: 50 },
        { fetchPage }
      )
    ).toBe('unsupported');
  });

  it('shares one device read and one request between two readers of a page', async () => {
    const message = graphqlMessage(1);
    const host = startedHost(() => devicePage([], { covered: false }));
    const fetchPage = vi.fn(async () =>
      fetched(serverPage({ entries: [message] }))
    );

    const [first, second] = await Promise.all([
      loadChannelPage(
        host,
        { channelId: CHANNEL_ID, limit: 50 },
        { fetchPage }
      ),
      loadChannelPage(
        host,
        { channelId: CHANNEL_ID, limit: 50 },
        { fetchPage }
      ),
    ]);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(host.reads).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('waits on the device alone for an older page', async () => {
    const message = graphqlMessage(1);
    const host = startedHost([devicePage([keyOf(message)])], {
      records: [message],
    });
    const fetchPage = vi.fn();

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50, before: graphqlMessage(5).sortKey },
      { fetchPage }
    );

    expect(loaded).toMatchObject({ source: 'device' });
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('shows the server page when the device is still starting, then records it', async () => {
    const message = graphqlMessage(1);
    const host = fakeHost([devicePage([], { covered: false, seq: null })]);
    let start: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const answer = host.channelTimeline.bind(host);
    host.channelTimeline = async (args) => {
      await started;
      return answer(args);
    };
    const fetchPage = vi.fn(async () =>
      fetched(serverPage({ entries: [message] }))
    );

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );

    if (typeof loaded === 'string' || loaded.source !== 'server') {
      throw new Error('expected a server page');
    }
    expect(loaded.page.entries).toHaveLength(1);
    expect(host.commits).toEqual([]);
    start();
    expect(await loaded.stored).toBe('9');
    expect(host.commits).toHaveLength(1);
  });

  it('prefers a held page from a device that answers before the server', async () => {
    const message = graphqlMessage(1);
    const host = fakeHost([devicePage([keyOf(message)], { seq: '7' })], {
      records: [message],
    });
    const fetchPage = vi.fn(
      () => new Promise<FetchedChannelPage>(() => undefined)
    );

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );

    expect(loaded).toMatchObject({ source: 'device', storedSeq: '7' });
    expect(host.commits).toEqual([]);
  });

  it('opens from a starting device when the request fails', async () => {
    const message = graphqlMessage(1);
    const host = fakeHost([devicePage([keyOf(message)], { seq: '7' })], {
      records: [message],
    });
    let start: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const answer = host.channelTimeline.bind(host);
    host.channelTimeline = async (args) => {
      await started;
      return answer(args);
    };
    const fetchPage = vi.fn(async () => {
      throw new Error('offline');
    });

    const loading = loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );
    start();

    expect(await loading).toMatchObject({ source: 'device', storedSeq: '7' });
  });

  it('fails when the request fails and the device holds nothing', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const fetchPage = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(
      loadChannelPage(host, { channelId: CHANNEL_ID, limit: 50 }, { fetchPage })
    ).rejects.toThrow('offline');
  });

  it('leaves a starting device alone in the background', async () => {
    vi.useFakeTimers();
    const host = fakeHost([]);
    host.channelTimeline = () => new Promise(() => undefined);
    const fetchPage = vi.fn();

    const loading = loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage, background: true }
    );
    await vi.runAllTimersAsync();

    expect(await loading).toBe('not-ready');
    expect(fetchPage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('answers a repeated read from the page still being recorded', async () => {
    const message = graphqlMessage(1);
    const host = startedHost(() => devicePage([], { covered: false }));
    let confirm: () => void = () => undefined;
    const cached = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    const fetchPage = vi.fn(async () => ({
      page: serverPage({ entries: [message] }),
      cached,
    }));
    const request = { channelId: CHANNEL_ID, limit: 50 };

    const first = await loadChannelPage(host, request, { fetchPage });
    const second = await loadChannelPage(host, request, { fetchPage });

    expect(second).toBe(first);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    confirm();
    if (typeof first === 'string' || first.source !== 'server') {
      throw new Error('expected a server page');
    }
    await first.stored;
  });
});

describe('serverPageCoverage', () => {
  const newest = graphqlMessage(9);
  const oldest = graphqlMessage(4);
  const entries = [newest, oldest];

  it('covers the whole channel when the latest page is all of it', () => {
    expect(serverPageCoverage({}, serverPage({ entries }))).toEqual({
      start: CHANNEL_TIMELINE_START,
      end: CHANNEL_TIMELINE_HEAD,
    });
    expect(serverPageCoverage({}, serverPage())).toEqual({
      start: CHANNEL_TIMELINE_START,
      end: CHANNEL_TIMELINE_HEAD,
    });
  });

  it('ends an older page at the cursor it was read before', () => {
    expect(
      serverPageCoverage(
        { before: 'cursor' },
        serverPage({ entries, olderCursor: oldest.sortKey })
      )
    ).toEqual({ start: oldest.sortKey, end: 'cursor' });
    expect(serverPageCoverage({ before: 'cursor' }, serverPage())).toEqual({
      start: CHANNEL_TIMELINE_START,
      end: 'cursor',
    });
  });

  it('starts a newer page at its cursor and reaches the live end only when nothing is newer', () => {
    expect(
      serverPageCoverage(
        { after: 'cursor' },
        serverPage({ entries, newerCursor: newest.sortKey })
      )
    ).toEqual({ start: 'cursor', end: newest.sortKey });
    expect(
      serverPageCoverage({ after: 'cursor' }, serverPage({ entries }))
    ).toEqual({ start: 'cursor', end: CHANNEL_TIMELINE_HEAD });
  });

  it('covers only the window fetched around a message', () => {
    expect(
      serverPageCoverage(
        { aroundMessageId: 'm' },
        serverPage({
          entries,
          olderCursor: oldest.sortKey,
          newerCursor: newest.sortKey,
        })
      )
    ).toEqual({ start: oldest.sortKey, end: newest.sortKey });
  });
});
