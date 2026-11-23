import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import { describe, expect, it, vi } from 'vitest';
import type * as ChannelNetwork from '../channel-network';
import {
  CHANNEL_TOUCH_INTERVAL_MS,
  type ChannelServerPage,
  createChannelTouches,
  type FetchChannelServerPage,
  loadChannelPage,
  serverPageCoverage,
} from '../channel-pages';
import { noteChannelReset, noteChannelsEvicted } from '../channel-resets';
import {
  CHANNEL_ID,
  devicePage,
  fakeHost,
  graphqlMessage,
  keyOf,
} from './fixtures';

vi.mock('../channel-network', async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelNetwork>()),
  queryChannelNetwork: () => {
    throw new Error('tests pass fetchPage');
  },
}));

const older = graphqlMessage(1);
const newer = graphqlMessage(2);

function serverPage(
  overrides: Partial<ChannelServerPage> = {}
): ChannelServerPage {
  return {
    entries: [newer, older],
    olderCursor: null,
    newerCursor: null,
    seq: '9',
    ...overrides,
  };
}

/** Counts every host request, the IPCs a native page would make. */
function countingHost(...args: Parameters<typeof fakeHost>) {
  const host = fakeHost(...args);
  const recordReads = vi.fn(host.readRecordsByKeys);
  host.readRecordsByKeys = recordReads;
  return {
    host,
    requests: () =>
      host.reads.length + host.commits.length + recordReads.mock.calls.length,
  };
}

describe('loadChannelPage', () => {
  it('answers a held page with two device requests and no server request', async () => {
    const { host, requests } = countingHost(
      [devicePage([keyOf(newer), keyOf(older)])],
      { records: [older, newer] }
    );
    const fetchPage = vi.fn<FetchChannelServerPage>();
    // Marked recently: an ordinary open writes nothing.
    const touches = { due: () => undefined };

    const loaded = await loadChannelPage(
      { host, touches, fetchPage },
      { channelId: CHANNEL_ID, limit: 50 }
    );

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.source).toBe('device');
    expect(loaded.page.entries.map((entry) => entry.key)).toEqual([
      keyOf(newer),
      keyOf(older),
    ]);
    expect(await loaded.stored).toBe('7');
    expect(requests()).toBe(2);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('marks a channel opened at most once every six hours', async () => {
    const { host } = countingHost(() => devicePage([keyOf(newer)]), {
      records: [newer],
    });
    let now = 1_000;
    const deps = { host, touches: createChannelTouches(), now: () => now };
    const open = () =>
      loadChannelPage(deps, { channelId: CHANNEL_ID, limit: 50 });

    await open();
    await open();
    now += CHANNEL_TOUCH_INTERVAL_MS;
    await open();

    await vi.waitFor(() => expect(host.commits).toHaveLength(2));
    expect(host.commits.map((commit) => commit.touchedAtMs)).toEqual([
      1_000,
      1_000 + CHANNEL_TOUCH_INTERVAL_MS,
    ]);
  });

  it('fetches a page the device lacks and commits it once the cache stores it', async () => {
    const { host } = countingHost([
      devicePage([], { covered: false, seq: null }),
    ]);
    let storeRecords!: () => void;
    const cached = new Promise<void>((resolve) => {
      storeRecords = resolve;
    });
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: serverPage(),
      cached,
    }));

    const loaded = await loadChannelPage(
      { host, touches: { due: () => 5 }, fetchPage },
      { channelId: CHANNEL_ID, limit: 50 }
    );

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.source).toBe('server');
    expect(loaded.page.entries).toHaveLength(2);
    expect(host.commits).toHaveLength(0);

    storeRecords();
    expect(await loaded.stored).toBe('9');
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [
          { start: CHANNEL_TIMELINE_START, end: CHANNEL_TIMELINE_HEAD },
        ],
        seq: { kind: 'lower', seq: '9' },
        touchedAtMs: 5,
      },
    ]);
  });

  it.each([
    ['the channel was reset', () => noteChannelReset],
    ['channels were evicted', () => noteChannelsEvicted],
  ] as const)(
    'commits no coverage when %s while the page was fetched',
    async (_, note) => {
      const { host } = countingHost([
        devicePage([], { covered: false, seq: null }),
      ]);
      let storeRecords!: () => void;
      const cached = new Promise<void>((resolve) => {
        storeRecords = resolve;
      });
      const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
        page: serverPage(),
        cached,
      }));

      const loaded = await loadChannelPage(
        { host, touches: { due: () => 5 }, fetchPage },
        { channelId: CHANNEL_ID, limit: 50 }
      );
      if (loaded === 'unsupported') throw new Error('unexpected');
      // The delete lands after the records were stored, before the coverage.
      note()(host, CHANNEL_ID);
      storeRecords();

      expect(await loaded.stored).toBeNull();
      expect(host.commits).toEqual([]);
      // The page itself still shows.
      expect(loaded.page.entries).toHaveLength(2);
    }
  );

  it('asks the server when the device read fails, never showing an empty channel', async () => {
    const { host } = countingHost(() => {
      throw new Error('host timed out');
    });
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: serverPage(),
      cached: Promise.resolve(),
    }));

    const loaded = await loadChannelPage(
      { host, touches: { due: () => undefined }, fetchPage },
      { channelId: CHANNEL_ID, limit: 50 }
    );

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.source).toBe('server');
    expect(loaded.page.entries).toHaveLength(2);
    // Nothing proves what the device holds, so nothing is committed.
    expect(await loaded.stored).toBeNull();
    expect(host.commits).toHaveLength(0);
  });

  it('hands a host that cannot serve channels back to REST', async () => {
    const { host } = countingHost([{ kind: 'unsupported' }]);
    const fetchPage = vi.fn<FetchChannelServerPage>();

    expect(
      await loadChannelPage(
        { host, touches: { due: () => undefined }, fetchPage },
        { channelId: CHANNEL_ID, limit: 50 }
      )
    ).toBe('unsupported');
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('serverPageCoverage', () => {
  it('reaches the live end for the latest page and the start at the first entry', () => {
    expect(serverPageCoverage({}, serverPage())).toEqual({
      start: CHANNEL_TIMELINE_START,
      end: CHANNEL_TIMELINE_HEAD,
    });
  });

  it('covers an older page from its oldest entry to its cursor', () => {
    expect(
      serverPageCoverage(
        { before: 'z' },
        serverPage({ olderCursor: older.sortKey })
      )
    ).toEqual({ start: older.sortKey, end: 'z' });
  });

  it('proves nothing for an empty window around a message', () => {
    expect(
      serverPageCoverage(
        { aroundMessageId: 'm' },
        serverPage({ entries: [], olderCursor: 'a', newerCursor: 'b' })
      )
    ).toBeUndefined();
  });
});
