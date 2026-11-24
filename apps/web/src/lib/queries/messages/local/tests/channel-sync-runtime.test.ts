import type {
  CacheRevision,
  ChannelTimelineCommitArgs,
  ChannelTimelineCommitCacheResult,
} from '@graphql-cache/index';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  announceEvicted,
  channelResetMark,
  holdAgainstDeletes,
  unchangedSince,
} from '../channel-resets';
import {
  CATCH_UP_DEBOUNCE_MS,
  type ChannelChangesPage,
  type ChannelSyncRuntime,
  createChannelSyncRuntime,
  MAX_CHANGE_PAGES,
} from '../channel-sync-runtime';
import { announceWritten } from '../channel-tab-writes';
import { fakeLocks } from './fake-locks';
import { CHANNEL_ID, devicePage } from './fixtures';

/**
 * A device holding the channel at `seq` (null: not held), applying commits
 * as the engine does: `lower` takes the minimum, `advance` applies only from
 * the stored value.
 */
function syncHost(initial: bigint | null) {
  const host = {
    seq: initial,
    commits: [] as ChannelTimelineCommitArgs[],
    generations: [] as string[],
    heads: 0,
    async channelTimeline() {
      host.heads += 1;
      return devicePage([], {
        covered: host.seq !== null,
        seq: host.seq === null ? null : host.seq.toString(),
      });
    },
    async channelTimelineCommit(
      args: ChannelTimelineCommitArgs,
      generation: string
    ): Promise<ChannelTimelineCommitCacheResult> {
      host.commits.push(args);
      host.generations.push(generation);
      if (args.reset) host.seq = null;
      const seq = args.seq;
      if (seq?.kind === 'advance' && host.seq?.toString() === seq.from) {
        host.seq = BigInt(seq.to);
      }
      if (seq?.kind === 'lower' && host.seq !== null) {
        const lowered = BigInt(seq.seq);
        if (lowered < host.seq) host.seq = lowered;
      }
      return {
        kind: 'committed' as const,
        revision: '1' as CacheRevision,
        changed: [],
        channelSeq: host.seq === null ? null : host.seq.toString(),
      };
    },
  };
  return host;
}

const changes = (
  seq: number,
  overrides: Partial<ChannelChangesPage> = {}
): ChannelChangesPage => ({
  resetRequired: false,
  seq: String(seq),
  hasMore: false,
  removedIds: [],
  messages: [],
  activities: [],
  ...overrides,
});

const frame = (seq: number, removedIds: string[] = []) => ({
  channelId: CHANNEL_ID,
  seq: String(seq),
  removedIds,
});

const runtimes: ChannelSyncRuntime[] = [];

function setup(
  initial: bigint | null,
  fetchChanges: (after: string) => ChannelChangesPage = (after) =>
    changes(Number(after))
) {
  const host = syncHost(initial);
  const fetch = vi.fn(async (_channelId: string, after: string) =>
    fetchChanges(after)
  );
  const runtime = createChannelSyncRuntime({
    host,
    fetchChanges: (channelId, after) => fetch(channelId, after),
    generation: () => 'generation-1',
    random: () => 0,
  });
  runtimes.push(runtime);
  const changed = vi.fn();
  runtime.onChanged(CHANNEL_ID, changed);
  return { host, fetch, runtime, changed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => boolean, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition never held');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe('createChannelSyncRuntime', () => {
  it('advances the stored sequence from a frame that continues it, with no request', async () => {
    const { host, fetch, runtime, changed } = setup(5n);
    runtime.onConnected();

    runtime.onFrame(frame(6, ['gone']), true);
    await waitFor(() => host.seq === 6n);

    expect(fetch).not.toHaveBeenCalled();
    expect(host.commits).toEqual([
      {
        channelId: CHANNEL_ID,
        removedKeys: [
          'GraphqlChannelMessage:gone',
          'GraphqlChannelTimelineActivity:gone',
        ],
        seq: { kind: 'advance', from: '5', to: '6' },
      },
    ]);
    await waitFor(() => changed.mock.calls.length > 0);
  });

  it('commits a frame in the cache session that stored its records', async () => {
    const { host, runtime } = setup(5n);
    runtime.onConnected();
    runtime.onFrame(frame(6), true, 'generation-0');
    await waitFor(() => host.commits.length > 0);
    expect(host.generations).toEqual(['generation-0']);
  });

  it('replays from before a frame that arrived after a newer one', async () => {
    // Frame 11 stored its records after frame 12 stored newer ones.
    const { host, fetch, runtime } = setup(10n);
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    runtime.onFrame(frame(12), true);
    runtime.onFrame(frame(11), true);
    await waitFor(() => host.seq === 12n);
    await waitFor(() => fetch.mock.calls.some(([, after]) => after === '10'));
    expect(fetch).not.toHaveBeenCalledWith(CHANNEL_ID, '12');
    release();
  });

  it('replays from before a frame the device had already moved past', async () => {
    const { fetch, runtime } = setup(12n);
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    runtime.onFrame(frame(11), true);
    await waitFor(() => fetch.mock.calls.length > 0);
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '10');
    // Replayed: an open asks nothing more.
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
  });

  it('reads the stored sequence once, however many frames arrive', async () => {
    const { host, runtime } = setup(5n);
    runtime.onConnected();
    for (const seq of [6, 7, 8]) runtime.onFrame(frame(seq), true);
    await waitFor(() => host.seq === 8n);
    expect(host.heads).toBe(1);
  });

  it('ignores frames for a channel the device does not hold', async () => {
    const { host, fetch, runtime } = setup(null);
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    runtime.onFrame(frame(6), true);
    await new Promise((resolve) =>
      setTimeout(resolve, CATCH_UP_DEBOUNCE_MS * 2)
    );
    // One empty commit: a sync row the eviction sweep can find.
    expect(host.commits).toEqual([{ channelId: CHANNEL_ID }]);
    expect(fetch).not.toHaveBeenCalled();
    release();
  });

  it('gives an unheld channel one sync row however many frames store records', async () => {
    const { host, runtime } = setup(null);
    runtime.onConnected();
    runtime.onFrame(frame(6), true);
    runtime.onFrame(frame(7), true);
    runtime.onFrame(frame(8), false);
    await waitFor(() => host.commits.length > 0);
    await settle();

    expect(host.commits).toEqual([{ channelId: CHANNEL_ID }]);
    expect(host.heads).toBe(1);
    expect(host.seq).toBeNull();
  });

  it('gives an unheld channel its row again when eviction lands while the row is written', async () => {
    const { host, runtime } = setup(null);
    const write = host.channelTimelineCommit;
    const waiting: (() => void)[] = [];
    host.channelTimelineCommit = (args, generation) =>
      new Promise((resolve) => {
        waiting.push(() => resolve(write(args, generation)));
      });
    runtime.onConnected();
    runtime.onFrame(frame(6), true);
    await waitFor(() => waiting.length === 1);

    // Eviction removed the channel's row before the write was acknowledged.
    runtime.forget([CHANNEL_ID]);
    waiting[0]();
    await settle();
    runtime.onFrame(frame(7), true);

    await waitFor(() => waiting.length === 2);
    waiting[1]();
    await waitFor(() => host.commits.length === 2);
    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID },
      { channelId: CHANNEL_ID },
    ]);
  });

  it('holds a frame past a gap and catches up a channel on screen', async () => {
    const { host, fetch, runtime } = setup(5n, () => changes(7));
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);

    runtime.onFrame(frame(8), true);
    await waitFor(() => host.seq === 8n);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '5');
    // The catch-up reached 7, and the held frame took it to 8.
    expect(host.commits.map((commit) => commit.seq)).toEqual([
      { kind: 'advance', from: '5', to: '7' },
      { kind: 'advance', from: '7', to: '8' },
    ]);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
  });

  it('leaves a gap in a channel off screen until it is opened', async () => {
    const { fetch, runtime } = setup(5n, () => changes(7));
    runtime.onConnected();
    runtime.onFrame(frame(8), true);
    await new Promise((resolve) =>
      setTimeout(resolve, CATCH_UP_DEBOUNCE_MS * 2)
    );
    expect(fetch).not.toHaveBeenCalled();

    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('applied');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one catch-up among frames that closely follow each other', async () => {
    const { fetch, runtime } = setup(5n, () => changes(12));
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    for (const seq of [8, 10, 12]) runtime.onFrame(frame(seq), false);
    await waitFor(() => fetch.mock.calls.length > 0);
    await new Promise((resolve) =>
      setTimeout(resolve, CATCH_UP_DEBOUNCE_MS * 2)
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
  });

  it('asks nothing when opening a channel proven current by a server read', async () => {
    const { fetch, runtime } = setup(null);
    runtime.onConnected();
    runtime.noteServerRead(CHANNEL_ID, '9', runtime.epoch(), '9');

    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('catches up from the stored sequence when the server read a newer one', async () => {
    // The device kept sequence 9 and its rows; the page was read at 12. A
    // row deleted at 10 is still on the device until changes after 9 replay.
    const { fetch, runtime } = setup(9n);
    runtime.onConnected();
    runtime.noteServerRead(CHANNEL_ID, '9', runtime.epoch(), '12');

    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '9');
  });

  it('does not trust a server read across a disconnect', async () => {
    const { host, fetch, runtime } = setup(9n);
    runtime.onConnected();
    const epoch = runtime.epoch();
    runtime.onDisconnected();
    runtime.onConnected();
    runtime.noteServerRead(CHANNEL_ID, '9', epoch, '9');

    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '9');
    expect(host.commits).toEqual([]);
  });

  it('catches up a server read that a frame already went past', async () => {
    const { fetch, runtime } = setup(null, () => changes(11));
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    runtime.onFrame(frame(11), true);
    await settle();
    runtime.noteServerRead(CHANNEL_ID, '9', runtime.epoch(), '9');
    await waitFor(() => fetch.mock.calls.length > 0);
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '9');
    release();
  });

  it('catches up the channels on screen after a reconnect', async () => {
    const { fetch, runtime } = setup(5n);
    runtime.onConnected();
    runtime.noteStoredSeq(CHANNEL_ID, '5');
    const release = runtime.open(CHANNEL_ID);
    runtime.onDisconnected();
    runtime.onConnected();
    await waitFor(() => fetch.mock.calls.length > 0);
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '5');
    release();
  });

  it('ends the request of a catch-up when the runtime is disposed', async () => {
    const signals: AbortSignal[] = [];
    const runtime = createChannelSyncRuntime({
      host: syncHost(5n),
      fetchChanges: (_channelId, _after, signal) => {
        signals.push(signal);
        return new Promise<never>(() => {});
      },
      generation: () => 'generation-1',
      random: () => 0,
    });
    runtime.onConnected();
    runtime.noteStoredSeq(CHANNEL_ID, '5');
    runtime.open(CHANNEL_ID);
    runtime.onDisconnected();
    runtime.onConnected();
    await waitFor(() => signals.length > 0);
    expect(signals[0]?.aborted).toBe(false);
    runtime.dispose();
    await waitFor(() => signals[0]?.aborted === true);
  });

  it('drops the channel when it is too far behind to replay', async () => {
    let after = 5;
    const { host, fetch, runtime, changed } = setup(5n, () => {
      after += 200;
      return changes(after, { hasMore: true });
    });

    const mark = channelResetMark(host, CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('reset');
    expect(fetch).toHaveBeenCalledTimes(MAX_CHANGE_PAGES);
    expect(unchangedSince(host, CHANNEL_ID, mark)).toBe(false);
    expect(host.commits.at(-1)).toEqual({
      channelId: CHANNEL_ID,
      reset: true,
    });
    expect(host.seq).toBeNull();
    expect(changed).toHaveBeenCalled();
  });

  it('drops the channel when the server says to', async () => {
    const { host, runtime } = setup(5n, () =>
      changes(5, { resetRequired: true })
    );
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('reset');
    expect(host.seq).toBeNull();
  });

  it('tries the sync row again when its first commit fails', async () => {
    const { host, runtime } = setup(null);
    const commit = host.channelTimelineCommit;
    let failures = 1;
    host.channelTimelineCommit = async (args, generation) => {
      if (failures > 0) {
        failures -= 1;
        host.commits.push(args);
        throw new Error('commit timed out');
      }
      return commit(args, generation);
    };
    runtime.onFrame(frame(6), true);
    await waitFor(() => host.commits.length === 1);
    await settle();

    runtime.onFrame(frame(7), true);
    await waitFor(() => host.commits.length === 2);
    await settle();
    runtime.onFrame(frame(8), true);
    await settle();

    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID },
      { channelId: CHANNEL_ID },
    ]);
  });

  it('tries the sync row again when the device does not write it', async () => {
    const { host, runtime } = setup(null);
    const commit = host.channelTimelineCommit;
    let refusals = 1;
    host.channelTimelineCommit = async (args, generation) => {
      if (refusals > 0) {
        refusals -= 1;
        host.commits.push(args);
        return { kind: 'unsupported' as const };
      }
      return commit(args, generation);
    };
    runtime.onFrame(frame(6), true);
    await waitFor(() => host.commits.length === 1);
    await settle();

    runtime.onFrame(frame(7), true);
    await waitFor(() => host.commits.length === 2);
    await settle();
    runtime.onFrame(frame(8), true);
    await settle();

    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID },
      { channelId: CHANNEL_ID },
    ]);
  });

  it("rereads a channel another tab's write changed", async () => {
    const { changed } = setup(5n);

    // With no connection no frame tells this tab: the other tab says so.
    const other = new BroadcastChannel('macro.channel-timeline.writes');
    other.postMessage({ channelIds: [CHANNEL_ID] });
    other.close();
    await waitFor(() => changed.mock.calls.length === 1);
  });

  it('does not reread for a write this tab announced itself', async () => {
    const { runtime, changed } = setup(5n);
    const otherChanged = vi.fn();
    runtime.onChanged('other-channel', otherChanged);

    announceWritten(CHANNEL_ID);
    // Another tab's announcement, sent after, arrives after it.
    const other = new BroadcastChannel('macro.channel-timeline.writes');
    other.postMessage({ channelIds: ['other-channel'] });
    other.close();
    await waitFor(() => otherChanged.mock.calls.length === 1);
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });

  it('gives a channel evicted in another tab a sync row again', async () => {
    const { host, runtime } = setup(null);
    runtime.onFrame(frame(6), true);
    await waitFor(() => host.commits.length === 1);
    await settle();

    // Another tab's prewarm removed the row with the records.
    announceEvicted([CHANNEL_ID]);
    await waitFor(() => {
      runtime.onFrame(frame(7), true);
      return host.commits.length === 2;
    });

    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID },
      { channelId: CHANNEL_ID },
    ]);
  });

  it('gives an evicted channel a sync row again', async () => {
    const { host, runtime } = setup(null);
    runtime.onFrame(frame(6), true);
    await waitFor(() => host.commits.length === 1);
    await settle();

    // Eviction removed the row with the records.
    runtime.forget([CHANNEL_ID]);
    runtime.onFrame(frame(7), true);
    await waitFor(() => host.commits.length === 2);

    expect(host.commits).toEqual([
      { channelId: CHANNEL_ID },
      { channelId: CHANNEL_ID },
    ]);
    expect(host.heads).toBe(2);
  });

  it('catches up a channel on screen when a frame fails to commit', async () => {
    const { host, fetch, runtime, changed } = setup(5n, () => changes(6));
    runtime.onConnected();
    const release = runtime.open(CHANNEL_ID);
    const commit = host.channelTimelineCommit;
    let failures = 1;
    host.channelTimelineCommit = async (args, generation) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('commit timed out');
      }
      return commit(args, generation);
    };

    runtime.onFrame(frame(6), true);
    await waitFor(() => host.seq === 6n);

    // The records were stored: views reread, and a catch-up moved the
    // sequence the frame could not.
    expect(changed).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(CHANNEL_ID, '5');
    release();
  });

  it('resets a channel only once no fill in another tab is mid-store', async () => {
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    const { host, runtime } = setup(5n, () =>
      changes(5, { resetRequired: true })
    );
    const fill = await holdAgainstDeletes();

    const reset = runtime.ensureCurrent(CHANNEL_ID);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.commits).toEqual([]);

    fill?.release();
    await expect(reset).resolves.toBe('reset');
    expect(host.commits).toEqual([{ channelId: CHANNEL_ID, reset: true }]);
    vi.unstubAllGlobals();
  });

  it('forgets every channel after a storage reset', async () => {
    const { host, runtime } = setup(5n);
    runtime.onConnected();
    runtime.onFrame(frame(6), true);
    await waitFor(() => host.seq === 6n);

    runtime.forgetAll();
    host.seq = 2n;
    runtime.onFrame(frame(3), true);
    await waitFor(() => host.seq === 3n);
    expect(host.heads).toBe(2);
  });
});
