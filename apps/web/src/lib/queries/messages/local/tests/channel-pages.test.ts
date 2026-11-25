import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import type {
  ChannelCommitArgs,
  ChannelCommitOutcome,
} from '@graphql-cache/index';
import {
  CHANNEL_TIMELINE_HEAD,
  CHANNEL_TIMELINE_START,
} from '@graphql-cache/index';
import {
  cacheSessionGeneration,
  createSessionGeneration,
} from '@graphql-cache/session-generation';
import { describe, expect, it, vi } from 'vitest';
import type * as ChannelNetwork from '../channel-network';
import {
  CHANNEL_TOUCH_INTERVAL_MS,
  type ChannelServerPage,
  createChannelTouches,
  type FetchChannelServerPage,
  loadChannelPage,
  serverPageCoverage,
  touchSessionAccepts,
} from '../channel-pages';
import {
  applied,
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

/**
 * A server that answers each ask with `page`, recording the commit sent
 * beside it, whose store comes to `stored(ask)`.
 */
function server(
  stored: (
    ask: number
  ) =>
    | ChannelCommitOutcome
    | undefined
    | Promise<ChannelCommitOutcome | undefined> = () => applied('9'),
  page = serverPage()
) {
  const commits: (ChannelCommitArgs | undefined)[] = [];
  const fetchPage = vi.fn<FetchChannelServerPage>(async (_input, options) => {
    commits.push(options.commit?.(page));
    const ask = commits.length;
    return { page, cached: (async () => stored(ask))() };
  });
  return { fetchPage, commits };
}

/** A commit the device refuses once, as after a session change, then stores. */
function refuseFirstCommit() {
  let refused = false;
  return () => {
    if (refused) return undefined;
    refused = true;
    throw new StaleCacheAuthorityError();
  };
}

/**
 * Every commit sent to `host`, settled. A mark is settled as its commit
 * answers, before a caller awaiting that answer later resumes.
 */
function sentCommits(host: ReturnType<typeof fakeHost>) {
  const sent: Promise<unknown>[] = [];
  const commit = host.channelTimelineCommit;
  host.channelTimelineCommit = (...args) => {
    const answer = commit(...args);
    sent.push(answer);
    return answer;
  };
  return () => Promise.allSettled(sent);
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
    const touches = { due: () => undefined, settled: () => {} };

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
    expect(await loaded.stored).toBe('held');
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

    expect(host.commits.map((commit) => commit.touchedAtMs)).toEqual([
      1_000,
      1_000 + CHANNEL_TOUCH_INTERVAL_MS,
    ]);
  });

  it('marks a channel opened again when the device did not store the last mark', async () => {
    const { host } = countingHost(() => devicePage([keyOf(newer)]), {
      records: [newer],
      commit: refuseFirstCommit(),
    });
    const answered = sentCommits(host);
    let now = 1_000;
    const deps = { host, touches: createChannelTouches(), now: () => now };
    const open = () =>
      loadChannelPage(deps, { channelId: CHANNEL_ID, limit: 50 });

    await open();
    await answered();
    now += 1;
    await open();

    expect(host.commits.map((commit) => commit.touchedAtMs)).toEqual([
      1_000, 1_001,
    ]);
  });

  it('marks a channel opened in a new session while the old session still sends its mark', async () => {
    const { host } = countingHost(() => devicePage([keyOf(newer)]), {
      records: [newer],
    });
    const oldSession = cacheSessionGeneration.capture();
    const oldMark = Promise.withResolvers<never>();
    const commit = host.channelTimelineCommit;
    host.channelTimelineCommit = (args, generation) => {
      if (generation !== oldSession) return commit(args, generation);
      host.commits.push(args);
      return oldMark.promise;
    };
    const answered = sentCommits(host);
    let now = 1_000;
    const deps = { host, touches: createChannelTouches(), now: () => now };
    const open = () =>
      loadChannelPage(deps, { channelId: CHANNEL_ID, limit: 50 });

    await open();
    await cacheSessionGeneration.transition(async () => {}, 'test');
    now += 1;
    await open();
    oldMark.reject(new StaleCacheAuthorityError());
    await answered();
    now += 1;
    await open();

    expect(host.commits.map((sent) => sent.touchedAtMs)).toEqual([
      1_000, 1_001,
    ]);
  });

  it('marks a channel again after a fill whose commit the device refused', async () => {
    const { host } = countingHost([
      devicePage([], { covered: false, seq: null }),
      devicePage([], { covered: false, seq: null }),
    ]);
    const { fetchPage, commits } = server((ask) =>
      ask === 1 ? undefined : applied('9')
    );
    let now = 1_000;
    const deps = {
      host,
      touches: createChannelTouches(),
      fetchPage,
      now: () => now,
    };
    const fill = async () => {
      const loaded = await loadChannelPage(deps, {
        channelId: CHANNEL_ID,
        limit: 50,
      });
      if (loaded === 'unsupported') throw new Error('unexpected');
      return loaded.stored;
    };

    await fill();
    now += 1;
    await fill();

    expect(commits.map((commit) => commit?.touchedAtMs)).toEqual([
      1_000, 1_001,
    ]);
  });

  it('fetches a page the device lacks, to be stored with what it proves', async () => {
    const { host } = countingHost([
      devicePage([], { covered: false, seq: null }),
    ]);
    const stored = Promise.withResolvers<ChannelCommitOutcome>();
    const { fetchPage, commits } = server(() => stored.promise);

    const loaded = await loadChannelPage(
      { host, touches: { due: () => 5, settled: () => {} }, fetchPage },
      { channelId: CHANNEL_ID, limit: 50 }
    );

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.source).toBe('server');
    expect(loaded.page.entries).toHaveLength(2);
    if (loaded.source === 'server') expect(loaded.readSeq).toBe('9');

    // Another read left the device behind this page.
    stored.resolve(applied('8'));
    expect(await loaded.stored).toBe('held');
    expect(host.commits).toEqual([]);
    expect(commits).toEqual([
      {
        channelId: CHANNEL_ID,
        coverage: [
          { start: CHANNEL_TIMELINE_START, end: CHANNEL_TIMELINE_HEAD },
        ],
        seq: '9',
        watermark: { kind: 'lower' },
        touchedAtMs: 5,
      },
    ]);
  });

  it('asks the server when the device read fails, never showing an empty channel', async () => {
    const { host } = countingHost(() => {
      throw new Error('host timed out');
    });
    const { fetchPage, commits } = server(() => undefined);

    const loaded = await loadChannelPage(
      { host, touches: { due: () => undefined, settled: () => {} }, fetchPage },
      { channelId: CHANNEL_ID, limit: 50 }
    );

    if (loaded === 'unsupported') throw new Error('unexpected');
    expect(loaded.source).toBe('server');
    expect(loaded.page.entries).toHaveLength(2);
    expect(commits).toHaveLength(1);
    expect(await loaded.stored).toBe('unheld');
  });

  it.each([
    ['failed', new Error('write lost'), 'unheld'],
    [
      'met a new cache session',
      new StaleCacheAuthorityError(),
      'session-changed',
    ],
  ])(
    'settles a page whose store %s without rejecting',
    async (_, error, outcome) => {
      const { host } = countingHost([devicePage([], { covered: false })]);
      const { fetchPage } = server(() => Promise.reject(error));

      const loaded = await loadChannelPage(
        {
          host,
          touches: { due: () => undefined, settled: () => {} },
          fetchPage,
        },
        { channelId: CHANNEL_ID, limit: 50 }
      );
      if (loaded === 'unsupported') throw new Error('unexpected');
      // A loader that moved on never reads it: it must not reject unhandled.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await loaded.stored).toBe(outcome);
    }
  );

  it('hands a host that cannot serve channels back to REST', async () => {
    const { host } = countingHost([{ kind: 'unsupported' }]);
    const fetchPage = vi.fn<FetchChannelServerPage>();

    expect(
      await loadChannelPage(
        {
          host,
          touches: { due: () => undefined, settled: () => {} },
          fetchPage,
        },
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

describe('createChannelTouches', () => {
  it('keeps the current session’s mark through late reads of earlier ones', () => {
    const touches = createChannelTouches(
      undefined,
      (generation) => generation === 'current'
    );
    expect(touches.due(CHANNEL_ID, 1_000, 'current')).toBe(1_000);
    touches.settled(CHANNEL_ID, 1_000, 'current', true);
    // Two reads sent before the session changed reach the touches late, and
    // the device refuses their marks after both.
    const late = ['oldest', 'previous'].map((earlier, index) => ({
      earlier,
      at: touches.due(CHANNEL_ID, 1_001 + index, earlier),
    }));
    for (const { earlier, at } of late)
      if (at !== undefined) touches.settled(CHANNEL_ID, at, earlier, false);

    expect(touches.due(CHANNEL_ID, 1_010, 'current')).toBeUndefined();
  });

  it('marks a channel read while the session it changed to is cleaning up', async () => {
    const session = createSessionGeneration('first');
    session.initialize('first');
    const cleanup = Promise.withResolvers<void>();
    const changed = session.transition(() => cleanup.promise, 'second');
    const touches = createChannelTouches(
      undefined,
      touchSessionAccepts(session)
    );

    expect(touches.due(CHANNEL_ID, 1_000, 'first')).toBeUndefined();
    expect(touches.due(CHANNEL_ID, 1_000, session.capture())).toBe(1_000);
    cleanup.resolve();
    await changed;
    expect(touches.due(CHANNEL_ID, 1_001, 'second')).toBeUndefined();
  });
});
