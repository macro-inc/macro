import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { describe, expect, it, vi } from 'vitest';
import {
  type ChannelServerPage,
  loadChannelPage,
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

describe('loadChannelPage', () => {
  it('answers a held page from the device without a request', async () => {
    const newest = graphqlMessage(3);
    const joined = graphqlActivity(2);
    const oldest = graphqlMessage(1);
    const host = fakeHost(
      [
        devicePage([newest, joined, oldest].map(keyOf), {
          olderCursor: oldest.sortKey,
        }),
      ],
      { records: [newest, joined, oldest] }
    );
    const fetchPage = vi.fn();

    const loaded = await loadChannelPage(
      host,
      { channelId: CHANNEL_ID, limit: 50 },
      { fetchPage }
    );

    expect(fetchPage).not.toHaveBeenCalled();
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
    const host = fakeHost([devicePage([], { covered: false, seq: null })]);
    const fetchPage = vi.fn(async () =>
      serverPage({ entries: [newest, oldest], olderCursor: oldest.sortKey })
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
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [{ start: oldest.sortKey, end: CHANNEL_TIMELINE_HEAD }],
        seq: { kind: 'lower', seq: '9' },
        touchedAtMs: 1234,
      },
    ]);
    expect(loaded).toMatchObject({
      source: 'server',
      serverSeq: '9',
      storedSeq: '9',
    });
  });

  it('fetches when a held key has no readable record', async () => {
    const message = graphqlMessage(1);
    const host = fakeHost([devicePage([keyOf(message)])]);
    const fetchPage = vi.fn(async () => serverPage({ entries: [message] }));

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
    const host = fakeHost([devicePage([keyOf(target)])], { records: [target] });

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
    const host = fakeHost([{ kind: 'unsupported' }]);
    const fetchPage = vi.fn();

    expect(
      await loadChannelPage(
        host,
        { channelId: CHANNEL_ID, limit: 50 },
        { fetchPage }
      )
    ).toBe('unsupported');
    expect(fetchPage).not.toHaveBeenCalled();
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
