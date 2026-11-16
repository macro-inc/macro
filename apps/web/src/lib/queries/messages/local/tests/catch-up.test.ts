import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageKeys } from '../../keys';
import {
  type ChannelChangesPage,
  catchUpAndRefresh,
  catchUpChannel,
  noteChannelPush,
  pushesStored,
  rereadChannelsAfterStorageReset,
  resetChannelSync,
  storeUnstoredPushes,
} from '../catch-up';
import { channelActivityKey, channelMessageKey } from '../sort-key';
import {
  noteUnstoredPush,
  resetUnstoredPushes,
  unstoredPushChannels,
} from '../unstored-pushes';
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';

const { invalidateQueries, channelCacheHost } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  channelCacheHost: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));
vi.mock('../../../client', () => ({ queryClient: { invalidateQueries } }));
vi.mock('../flag', () => ({ channelCacheHost }));

const changes = (
  overrides: Partial<ChannelChangesPage> = {}
): ChannelChangesPage => ({
  resetRequired: false,
  seq: '7',
  hasMore: false,
  messages: [],
  activities: [],
  removedIds: [],
  ...overrides,
});

/** A host whose stored sequence follows the commits it receives. */
function sequencedHost(initial: string | null) {
  let seq = initial;
  const host = fakeHost(() => devicePage([], { seq }), {
    commit: (args) => {
      if (args.reset) seq = null;
      else if (args.seq?.kind === 'advance' && args.seq.from === seq) {
        seq = args.seq.to;
      }
      return {
        kind: 'committed',
        revision: '1' as never,
        changed: [],
        channelSeq: seq,
      };
    },
  });
  return host;
}

afterEach(() => {
  vi.useRealTimers();
  channelCacheHost.mockReset();
  resetChannelSync();
  invalidateQueries.mockClear();
});

describe('catchUpChannel', () => {
  it('does nothing for a channel the device does not hold', async () => {
    const fetchChanges = vi.fn();
    expect(
      await catchUpChannel(sequencedHost(null), CHANNEL_ID, fetchChanges)
    ).toEqual({ kind: 'not-held' });
    expect(fetchChanges).not.toHaveBeenCalled();
  });

  it('reports a channel that is already current without a commit', async () => {
    const host = sequencedHost('7');
    expect(
      await catchUpChannel(host, CHANNEL_ID, async () => changes())
    ).toEqual({ kind: 'current', seq: '7' });
    expect(host.commits).toEqual([]);
  });

  it('applies every page of changes from the stored sequence', async () => {
    const host = sequencedHost('7');
    const fetchChanges = vi
      .fn()
      .mockResolvedValueOnce(
        changes({ seq: '9', hasMore: true, messages: [graphqlMessage(1)] })
      )
      .mockResolvedValueOnce(changes({ seq: '10', removedIds: ['gone'] }));

    expect(await catchUpChannel(host, CHANNEL_ID, fetchChanges)).toEqual({
      kind: 'applied',
      from: '7',
      seq: '10',
    });
    expect(fetchChanges.mock.calls).toEqual([
      [CHANNEL_ID, '7'],
      [CHANNEL_ID, '9'],
    ]);
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        removedKeys: [],
        seq: { kind: 'advance', from: '7', to: '9' },
      },
      {
        channelId: CHANNEL_ID,
        removedKeys: [channelMessageKey('gone'), channelActivityKey('gone')],
        seq: { kind: 'advance', from: '9', to: '10' },
      },
    ]);
  });

  it('drops the channel when the server can no longer replay its changes', async () => {
    const host = sequencedHost('7');
    expect(
      await catchUpChannel(host, CHANNEL_ID, async () =>
        changes({ resetRequired: true, seq: '5000' })
      )
    ).toEqual({ kind: 'reset' });
    expect(host.commits).toEqual([{ channelId: CHANNEL_ID, reset: true }]);
  });

  it('shares one run between concurrent callers', async () => {
    const host = sequencedHost('7');
    const fetchChanges = vi.fn(async () => changes({ seq: '8' }));
    const [first, second] = await Promise.all([
      catchUpChannel(host, CHANNEL_ID, fetchChanges),
      catchUpChannel(host, CHANNEL_ID, fetchChanges),
    ]);
    expect(first).toEqual(second);
    expect(fetchChanges).toHaveBeenCalledTimes(1);
  });
});

describe('catchUpAndRefresh', () => {
  it('has the open views read again after changes they did not get as pushes', async () => {
    await catchUpAndRefresh(sequencedHost('7'), CHANNEL_ID, async () =>
      changes({ seq: '9', messages: [graphqlMessage(1)] })
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('leaves the views alone when nothing changed', async () => {
    await catchUpAndRefresh(sequencedHost('7'), CHANNEL_ID, async () =>
      changes()
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('has the views reload a channel that was reset', async () => {
    await catchUpAndRefresh(sequencedHost('7'), CHANNEL_ID, async () =>
      changes({ resetRequired: true })
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});

describe('pushesStored', () => {
  it('answers at once when the views hold no push the device lacks', async () => {
    expect(await pushesStored(CHANNEL_ID)).toBe(false);
  });

  it('waits for the device to be asked to take a pushed change', async () => {
    vi.useFakeTimers();
    const host = sequencedHost(null);
    channelCacheHost.mockReturnValue(host);
    noteChannelPush(CHANNEL_ID, 8);

    let stored: boolean | undefined;
    const waiting = pushesStored(CHANNEL_ID).then((answer) => {
      stored = answer;
    });
    expect(stored).toBeUndefined();

    await vi.advanceTimersByTimeAsync(0);
    await waiting;
    expect(stored).toBe(true);
    expect(await pushesStored(CHANNEL_ID)).toBe(false);
  });

  it('gives up on a push the device does not take in time', async () => {
    vi.useFakeTimers();
    const host = sequencedHost('7');
    host.channelTimeline = () => new Promise(() => {});
    channelCacheHost.mockReturnValue(host);
    noteChannelPush(CHANNEL_ID, 8);

    const waiting = pushesStored(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await waiting).toBe(false);
  });

  it('does not wait for a push the device page already holds', async () => {
    vi.useFakeTimers();
    channelCacheHost.mockReturnValue(sequencedHost('8'));
    noteChannelPush(CHANNEL_ID, 8);

    expect(await pushesStored(CHANNEL_ID, '8')).toBe(false);
    expect(await pushesStored(CHANNEL_ID, '9')).toBe(false);
  });

  it('waits for a push newer than the device page', async () => {
    vi.useFakeTimers();
    channelCacheHost.mockReturnValue(sequencedHost(null));
    noteChannelPush(CHANNEL_ID, 8);

    let stored: boolean | undefined;
    const waiting = (async () => {
      stored = await pushesStored(CHANNEL_ID, '7');
    })();
    expect(stored).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    await waiting;
    expect(stored).toBe(true);
  });

  it('has a read made again that the device overtook meanwhile', async () => {
    await catchUpAndRefresh(sequencedHost('7'), CHANNEL_ID, async () =>
      changes({ seq: '9', messages: [graphqlMessage(1)] })
    );

    expect(await pushesStored(CHANNEL_ID, '7')).toBe(true);
    expect(await pushesStored(CHANNEL_ID, '9')).toBe(false);
  });

  it('lets a waiting read go when the channels are reset', async () => {
    vi.useFakeTimers();
    channelCacheHost.mockReturnValue(sequencedHost('7'));
    noteChannelPush(CHANNEL_ID, 8);

    const waiting = pushesStored(CHANNEL_ID);
    resetChannelSync();
    expect(await waiting).toBe(true);
    expect(await pushesStored(CHANNEL_ID)).toBe(false);
  });
});

describe('pushes a page that is gone left unstored', () => {
  afterEach(() => {
    resetUnstoredPushes();
    localStorage.clear();
  });

  it('notes a pushed channel until the device has taken the push', async () => {
    const host = sequencedHost('7');
    channelCacheHost.mockReturnValue(host);
    const fetchChanges = vi.fn(async () => changes({ seq: '8' }));

    noteChannelPush(CHANNEL_ID, 8);
    noteChannelPush(CHANNEL_ID, 9);
    expect(unstoredPushChannels()).toEqual([CHANNEL_ID]);

    // The log has only the first of the two so far.
    await catchUpAndRefresh(host, CHANNEL_ID, fetchChanges);
    expect(unstoredPushChannels()).toEqual([CHANNEL_ID]);

    fetchChanges.mockResolvedValue(changes({ seq: '9' }));
    await catchUpAndRefresh(host, CHANNEL_ID, fetchChanges);
    expect(unstoredPushChannels()).toEqual([]);
  });

  it('catches up what the page before left noted, and keeps what fails', async () => {
    const host = sequencedHost('7');
    channelCacheHost.mockReturnValue(host);
    // The page before was reloaded before the device took these.
    noteUnstoredPush(CHANNEL_ID);
    noteUnstoredPush('another-channel');
    resetUnstoredPushes();
    const fetchChanges = vi.fn(async (channelId: string) => {
      if (channelId !== CHANNEL_ID) throw new Error('offline');
      return changes({ seq: '8' });
    });

    await storeUnstoredPushes(host, fetchChanges);

    expect(fetchChanges).toHaveBeenCalledWith(CHANNEL_ID, '7');
    expect(unstoredPushChannels()).toEqual(['another-channel']);
  });
});

describe('rereadChannelsAfterStorageReset', () => {
  it('has channel pages and threads read again, and nothing else', () => {
    invalidateQueries.mockClear();

    rereadChannelsAfterStorageReset();

    expect(
      invalidateQueries.mock.calls.map(([filter]) => filter.queryKey)
    ).toEqual([messageKeys.messages._def, messageKeys.threadReplies._def]);
    const channel = { type: 'channel' as const, id: CHANNEL_ID };
    const document = { type: 'document' as const, id: 'a-document' };
    for (const [filter] of invalidateQueries.mock.calls) {
      expect(
        filter.predicate({ queryKey: messageKeys.messages(channel).queryKey })
      ).toBe(true);
      expect(
        filter.predicate({ queryKey: messageKeys.messages(document).queryKey })
      ).toBe(false);
      expect(
        filter.predicate({
          queryKey: messageKeys.threadReplies(channel, 'a-root').queryKey,
        })
      ).toBe(true);
      expect(
        filter.predicate({
          queryKey: messageKeys.threadReplies(document, 'a-root').queryKey,
        })
      ).toBe(false);
    }
  });

  it('forgets the pushes the reset device no longer has to take', async () => {
    const host = sequencedHost('7');
    channelCacheHost.mockReturnValue(host);
    noteChannelPush(CHANNEL_ID, 8);

    rereadChannelsAfterStorageReset();

    // Nothing is being stored for the channel any more: a read is not held up.
    expect(await pushesStored(CHANNEL_ID, '7')).toBe(false);
  });
});
