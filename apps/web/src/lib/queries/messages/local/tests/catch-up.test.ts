import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelChangesPage,
  catchUpAndRefresh,
  catchUpChannel,
  resetChannelSync,
} from '../catch-up';
import { channelActivityKey, channelMessageKey } from '../sort-key';
import { CHANNEL_ID, devicePage, fakeHost, graphqlMessage } from './fixtures';

const { invalidateQueries } = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));
vi.mock('../../../client', () => ({ queryClient: { invalidateQueries } }));

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
