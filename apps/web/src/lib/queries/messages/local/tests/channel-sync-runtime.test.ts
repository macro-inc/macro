import type { ChannelCommitOutcome } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStoreResult } from '../channel-network';
import {
  CATCH_UP_DEBOUNCE_MS,
  CATCH_UP_PAGE_BUDGET_MS,
  CATCH_UP_RETRY_MAX_MS,
  CATCH_UP_RETRY_MS,
  type ChannelChangesPage,
  type ChannelSyncRuntime,
  createChannelSyncRuntime,
  LISTENING_MS,
  MAX_CHANGE_PAGES,
} from '../channel-sync-runtime';
import { channelEngine } from './channel-engine';
import { CHANNEL_ID } from './fixtures';

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

const runtimes: ChannelSyncRuntime[] = [];

/**
 * A runtime over one channel of an engine. `fetchChanges` is the server's
 * answer; `latest` the sequence its latest page is read at.
 */
function setup(
  initial: string | null,
  fetchChanges: (
    after: string,
    signal: AbortSignal
  ) => ChannelChangesPage | Promise<ChannelChangesPage> = (after) =>
    changes(Number(after)),
  { latest = '900' }: { latest?: string } = {}
) {
  const engine = channelEngine(initial);
  // Answers the device refuses to store, each taken once.
  const refusals: unknown[] = [];
  // Acknowledgements kept back after the device stored, each once.
  const late: Promise<void>[] = [];
  const store = async (
    apply: () => ChannelCommitOutcome
  ): Promise<ChannelStoreResult> => {
    const error = refusals.shift();
    if (error !== undefined) return { stored: false, error };
    const outcome = apply();
    await late.shift();
    return { stored: true, outcome };
  };
  const fetch = vi.fn(
    async (_channelId: string, after: string, signal: AbortSignal) => {
      const page = await fetchChanges(after, signal);
      signal.throwIfAborted();
      const stored = page.resetRequired
        ? Promise.resolve<ChannelStoreResult>({
            stored: true,
            outcome: undefined,
          })
        : store(() =>
            engine.apply(
              {
                channelId: CHANNEL_ID,
                seq: page.seq,
                watermark: { kind: 'advance', from: after },
                removedIds: page.removedIds,
              },
              page.messages
            )
          );
      return { page, stored };
    }
  );
  const replaceWithLatest = vi.fn(async () => ({
    stored: store(() =>
      engine.apply({ channelId: CHANNEL_ID, seq: latest, reset: true })
    ),
  }));
  const runtime = createChannelSyncRuntime({
    host: engine.host,
    fetchChanges: fetch,
    replaceWithLatest,
    random: () => 0,
  });
  runtimes.push(runtime);
  const changed = vi.fn();
  runtime.onChanged(CHANNEL_ID, changed);
  /** The change sequences the server was asked after. */
  const asked = () => fetch.mock.calls.map(([, after]) => after);
  /** A pushed frame, stored by the device as it arrives. */
  const frame = (seq: number, removedIds: string[] = []) => {
    const outcome = engine.apply({
      channelId: CHANNEL_ID,
      seq: String(seq),
      watermark: { kind: 'advance', from: String(seq - 1) },
      removedIds,
    });
    runtime.onFrame({ channelId: CHANNEL_ID, seq: String(seq) });
    return outcome;
  };
  /** Another tab stores a page the server read at `seq`. */
  const lower = (seq: string) =>
    engine.apply({ channelId: CHANNEL_ID, seq, watermark: { kind: 'lower' } });
  /** A page the server read at `readSeq`, stored by the device. */
  const read = (readSeq: string, epoch = runtime.epoch()) => {
    lower(readSeq);
    runtime.noteServerRead(CHANNEL_ID, { readSeq, epoch });
  };
  return {
    engine,
    runtime,
    fetch,
    asked,
    replaceWithLatest,
    refusals,
    late,
    changed,
    frame,
    read,
    lower,
  };
}

/** Past the debounce of a scheduled catch-up. */
const debounced = () => vi.advanceTimersByTimeAsync(CATCH_UP_DEBOUNCE_MS + 1);
const settled = () => vi.advanceTimersByTimeAsync(0);
const quiet = () => vi.spyOn(Telemetry, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('frames', () => {
  it('follows frames that continue the watermark with no request', async () => {
    const { engine, runtime, fetch, frame } = setup('5');
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(fetch).toHaveBeenCalledTimes(1);

    frame(6);
    frame(7);
    await debounced();

    expect(engine.seq()).toBe('7');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('catches up a channel on screen past a gap', async () => {
    const { engine, runtime, asked, frame } = setup('5', () => changes(9));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);

    expect(frame(9).outcome).toBe('gap');
    await debounced();

    expect(asked()).toEqual(['5']);
    expect(engine.seq()).toBe('9');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('leaves a gap in a channel off screen until it is opened', async () => {
    const { runtime, asked, frame } = setup('5', () => changes(9));
    runtime.onConnected();
    frame(9);
    await debounced();
    expect(asked()).toEqual([]);

    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('applied');
    expect(asked()).toEqual(['5']);
  });

  it('shares one catch-up among frames that closely follow each other', async () => {
    const { runtime, asked, frame } = setup('5', () => changes(12));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    for (const seq of [8, 10, 12]) frame(seq);
    await debounced();
    expect(asked()).toEqual(['5']);
  });

  it('asks nothing for frames of a channel the device does not hold', async () => {
    const { runtime, fetch, frame } = setup(null);
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    frame(8);
    frame(9);
    await debounced();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('catches up when a read set the watermark before an unheld frame was told', async () => {
    const { runtime, asked, frame, engine, read } = setup(null, () =>
      changes(8)
    );
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    // The frame found nothing held; the page stored next was read before it.
    const outcome = engine.apply({
      channelId: CHANNEL_ID,
      seq: '8',
      watermark: { kind: 'advance', from: '7' },
    });
    expect(outcome.outcome).toBe('unheld');
    read('7');
    runtime.onFrame({ channelId: CHANNEL_ID, seq: '8' });
    await debounced();
    expect(asked()).toEqual(['7']);
    frame(9);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('catches up a channel on screen when a frame was not stored', async () => {
    const { runtime, asked } = setup('5', () => changes(6));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    runtime.onFrame({ channelId: CHANNEL_ID, seq: '6' });
    await debounced();
    expect(asked()).toEqual(['5']);
  });

  it('asks nothing for frames acknowledged in another order than stored', async () => {
    const { runtime, asked, engine } = setup('5');
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);

    for (const seq of [6, 7])
      engine.apply({
        channelId: CHANNEL_ID,
        seq: String(seq),
        watermark: { kind: 'advance', from: String(seq - 1) },
      });
    runtime.onFrame({ channelId: CHANNEL_ID, seq: '7' });
    runtime.onFrame({ channelId: CHANNEL_ID, seq: '6' });
    await debounced();
    expect(asked()).toEqual(['5']);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });
});

describe('server reads', () => {
  it('asks nothing when opening a channel a server read proved current', async () => {
    const { runtime, fetch, read } = setup(null);
    runtime.onConnected();
    read('8');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('catches up when the device kept an older sequence than the read', async () => {
    const { runtime, asked, read } = setup('5', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    read('8');
    await debounced();
    expect(asked()).toEqual(['5']);
  });

  it('does not trust a read sent before the connection', async () => {
    const { runtime, asked, read } = setup(null, () => changes(8));
    runtime.onConnected();
    const epoch = runtime.epoch();
    runtime.onDisconnected();
    runtime.onConnected();
    read('8', epoch);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['8']);
  });

  it('does not trust a read a frame had already gone past', async () => {
    const { runtime, asked, frame, read } = setup(null, () => changes(9));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    frame(9);
    read('8');
    await debounced();
    expect(asked()).toEqual(['8']);
  });

  it('catches up what an older read lowered, and stays current after one that did not', async () => {
    const { runtime, asked, read, engine } = setup('5', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(engine.seq()).toBe('8');

    read('8');
    await debounced();
    expect(asked()).toEqual(['5']);

    read('6');
    await debounced();
    expect(asked()).toEqual(['5', '6']);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it("catches up what another tab's page lowered", async () => {
    const { engine, runtime, asked, lower } = setup('8', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    lower('6');
    await debounced();
    expect(asked()).toEqual(['8', '6']);
    expect(engine.seq()).toBe('8');
  });

  it("stays current when another tab's frame is stored before it is told", async () => {
    const { engine, runtime, asked } = setup('8');
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    engine.apply({
      channelId: CHANNEL_ID,
      seq: '9',
      watermark: { kind: 'advance', from: '8' },
    });
    await debounced();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    expect(asked()).toEqual(['8']);
  });

  it('catches up an open channel another tab replaced with an older page', async () => {
    const { engine, runtime, asked } = setup('10', () => changes(10));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    // Requested before 10, and stored after it.
    engine.apply({ channelId: CHANNEL_ID, seq: '9', reset: true });
    await debounced();
    expect(asked()).toEqual(['10', '9']);
    expect(engine.seq()).toBe('10');
  });

  it('does not trust a read the device was reset under', async () => {
    const { engine, runtime, asked } = setup('8', () => changes(8));
    runtime.onConnected();
    const epoch = runtime.epoch();
    engine.apply({ channelId: CHANNEL_ID, seq: '7', reset: true });
    runtime.noteServerRead(CHANNEL_ID, { readSeq: '8', epoch });
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['7']);
    expect(engine.seq()).toBe('8');
  });

  it('does not trust a catch-up the device was reset under', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const { engine, runtime, asked } = setup('10', () =>
      asked().length === 1 ? answer.promise : changes(10)
    );
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const first = runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(0);
    engine.apply({ channelId: CHANNEL_ID, seq: '9', reset: true });
    answer.resolve(changes(10));
    await first;
    await debounced();
    expect(asked()).toEqual(['10', '9']);
    expect(engine.seq()).toBe('10');
  });

  it('catches up an open channel another tab fills', async () => {
    const { engine, runtime, asked, lower } = setup(null, () => changes(7));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('not-held');
    await debounced();
    lower('6');
    await debounced();
    expect(asked()).toEqual(['6']);
    expect(engine.seq()).toBe('7');
  });

  it('is not stranded by a late word that the device held nothing', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const ack = Promise.withResolvers<void>();
    const { engine, runtime, asked, late } = setup('7', () => answer.promise);
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const first = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    late.push(ack.promise);
    engine.setSeq(null);
    engine.push('evicted');
    answer.resolve(changes(7));
    await settled();
    engine.apply({ channelId: CHANNEL_ID, seq: '6', reset: true });
    ack.resolve();
    await first;
    await debounced();
    expect(asked()).toEqual(['7', '6']);
    expect(engine.seq()).toBe('7');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('asks nothing for a gap told once it was filled', async () => {
    const { runtime, asked } = setup('5');
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    runtime.onFrame({ channelId: CHANNEL_ID, seq: '4' });
    await debounced();
    expect(asked()).toEqual(['5']);
  });

  it('catches up what was lowered while the device read of a later change was out', async () => {
    const { engine, runtime, asked, lower } = setup('8', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    // The first read of the two answers with what it found before the second.
    const answer = Promise.withResolvers<void>();
    const read = engine.host.channelTimeline;
    vi.spyOn(engine.host, 'channelTimeline').mockImplementationOnce(
      async () => {
        const head = await read();
        await answer.promise;
        return head;
      }
    );
    engine.push('changed');
    await settled();
    lower('6');
    answer.resolve();
    await debounced();
    expect(asked()).toEqual(['8', '6']);
  });

  it('catches up a channel the device got while it answered that it held none', async () => {
    const { engine, runtime, asked, lower } = setup(null, () => changes(7));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const answer = Promise.withResolvers<void>();
    const read = engine.host.channelTimeline;
    vi.spyOn(engine.host, 'channelTimeline').mockImplementationOnce(
      async () => {
        const head = await read();
        await answer.promise;
        return head;
      }
    );
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    lower('6');
    await settled();
    answer.resolve();
    await expect(open).resolves.toBe('not-held');
    await debounced();
    expect(asked()).toEqual(['6']);
    expect(engine.seq()).toBe('7');
  });

  it('looks again when the device failed to say what it holds as a catch-up ended', async () => {
    const { engine, runtime, asked, lower } = setup('8', (after) =>
      changes(after === '8' ? 8 : 9)
    );
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const answer = Promise.withResolvers<void>();
    const read = engine.host.channelTimeline;
    const heads = vi
      .spyOn(engine.host, 'channelTimeline')
      // Where the catch-up starts, the change it stores, and where it ends.
      .mockImplementationOnce(read)
      .mockImplementationOnce(read)
      .mockImplementationOnce(async () => {
        const head = await read();
        await answer.promise;
        return head;
      })
      .mockRejectedValueOnce(new Error('device busy'));
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    expect(heads).toHaveBeenCalledTimes(3);
    lower('6');
    await settled();
    expect(heads).toHaveBeenCalledTimes(4);
    answer.resolve();
    await open;
    await debounced();
    expect(asked()).toEqual(['8', '6']);
  });

  it('catches up after a failed read of the device', async () => {
    const { engine, runtime, asked, lower } = setup('8', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    vi.spyOn(engine.host, 'channelTimeline').mockRejectedValueOnce(
      new Error('device busy')
    );
    lower('6');
    await debounced();
    expect(asked()).toEqual(['8', '6']);
  });

  it('does not trust a catch-up the device stored before a frame found it lower', async () => {
    const ack = Promise.withResolvers<void>();
    const { engine, runtime, asked, late, frame, lower } = setup('10', () =>
      changes(12)
    );
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    late.push(ack.promise);
    const first = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    expect(engine.seq()).toBe('12');
    lower('8');
    expect(frame(12).outcome).toBe('gap');
    ack.resolve();
    await first;
    await debounced();
    expect(asked()).toEqual(['10', '8']);
    expect(engine.seq()).toBe('12');
  });
});

describe('catch-up', () => {
  it('reads page after page from what the device holds', async () => {
    const { engine, runtime, asked } = setup('5', (after) =>
      after === '9'
        ? changes(12)
        : changes(Number(after) + 2, { hasMore: true })
    );
    runtime.onConnected();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('applied');
    expect(asked()).toEqual(['5', '7', '9']);
    expect(engine.seq()).toBe('12');
  });

  it('says nothing changed when nothing did', async () => {
    const { runtime } = setup('5');
    runtime.onConnected();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('asks nothing for a channel the device does not hold', async () => {
    const { runtime, fetch } = setup(null);
    runtime.onConnected();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('not-held');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads on from the device when a page lowered it under the request', async () => {
    const { engine, runtime, asked } = setup('5', (after) => {
      // Another tab's older page lands while the first request is out.
      if (after === '5') engine.setSeq('3');
      return changes(8);
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('applied');
    expect(asked()).toEqual(['5', '3']);
    expect(engine.seq()).toBe('8');
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('keeps what another tab got while the server answered that it was too far behind', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const { engine, runtime, asked, replaceWithLatest } = setup('5', (after) =>
      after === '5' ? answer.promise : changes(Number(after))
    );
    runtime.onConnected();
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    engine.apply({ channelId: CHANNEL_ID, seq: '900', reset: true });
    answer.resolve(changes(900, { resetRequired: true }));
    await expect(open).resolves.toBe('applied');
    expect(asked()).toEqual(['5', '900']);
    expect(replaceWithLatest).not.toHaveBeenCalled();
  });

  it('replaces nothing of a channel dropped while the server answered that it was too far behind', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const { engine, runtime, replaceWithLatest } = setup(
      '5',
      () => answer.promise
    );
    runtime.onConnected();
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    engine.setSeq(null);
    answer.resolve(changes(900, { resetRequired: true }));
    await expect(open).resolves.toBe('not-held');
    expect(replaceWithLatest).not.toHaveBeenCalled();
  });

  it('stops when the channel is dropped under the request', async () => {
    const { engine, runtime, asked } = setup('5', () => {
      engine.setSeq(null);
      return changes(8);
    });
    runtime.onConnected();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('not-held');
    expect(asked()).toEqual(['5']);
  });

  it('runs again when a frame went past what it read', async () => {
    const { runtime, asked, frame } = setup('5', (after) => {
      if (after !== '5') return changes(9);
      frame(9);
      return changes(6);
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    await debounced();
    expect(asked()).toEqual(['5', '6']);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it.each([
    ['the server says to', () => changes(5, { resetRequired: true }), 1],
    [
      'it is too far behind to replay',
      (after: string) => changes(Number(after) + 1, { hasMore: true }),
      MAX_CHANGE_PAGES,
    ],
  ])(
    'replaces the channel with its latest page when %s',
    async (_why, answer, asks) => {
      const { engine, runtime, fetch, replaceWithLatest, changed } = setup(
        '5',
        answer
      );
      runtime.onConnected();
      runtime.open(CHANNEL_ID);
      await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('reset');
      expect(fetch).toHaveBeenCalledTimes(asks);
      expect(replaceWithLatest).toHaveBeenCalledTimes(1);
      expect(engine.seq()).toBe('900');
      expect(changed).toHaveBeenLastCalledWith('reset');
      // Replaced in one step, so it is current at once.
      await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    }
  );

  it('runs one at a time, and the one that waited finds the channel current', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const { runtime, fetch } = setup('5', () => answer.promise);
    runtime.onConnected();
    const opens = [
      runtime.ensureCurrent(CHANNEL_ID),
      runtime.ensureCurrent(CHANNEL_ID),
    ];
    await settled();
    expect(fetch).toHaveBeenCalledTimes(1);
    answer.resolve(changes(6));
    await expect(Promise.all(opens)).resolves.toEqual(['applied', 'current']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('frees the channel when a page goes unanswered', async () => {
    quiet();
    let answered = false;
    const { runtime, asked, engine } = setup('5', () =>
      answered ? changes(6) : new Promise<ChannelChangesPage>(() => {})
    );
    runtime.onConnected();
    const first = runtime.ensureCurrent(CHANNEL_ID);
    const failed = expect(first).rejects.toThrow();
    await settled();
    answered = true;
    const second = runtime.ensureCurrent(CHANNEL_ID);
    await vi.advanceTimersByTimeAsync(CATCH_UP_PAGE_BUDGET_MS + 1);
    await failed;
    await expect(second).resolves.toBe('applied');
    expect(asked()).toEqual(['5', '5']);
    expect(engine.seq()).toBe('6');
  });

  it('fails when the device does not store the page, and leaves it to a retry', async () => {
    quiet();
    const { engine, runtime, asked, refusals } = setup('5', () => changes(6));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    refusals.push(new Error('disk full'));
    await expect(runtime.ensureCurrent(CHANNEL_ID)).rejects.toThrow(
      'disk full'
    );
    expect(engine.seq()).toBe('5');
    await vi.advanceTimersByTimeAsync(CATCH_UP_RETRY_MS + 1);
    expect(asked()).toEqual(['5', '5']);
    expect(engine.seq()).toBe('6');
  });

  it('waits twice as long after each failure in a row, up to the maximum', async () => {
    quiet();
    const { runtime, fetch } = setup('5', () => {
      throw new Error('service unavailable');
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).rejects.toThrow();
    let asks = 1;
    for (let wait = CATCH_UP_RETRY_MS; wait < 1e6; wait *= 2) {
      const due = Math.min(wait, CATCH_UP_RETRY_MAX_MS);
      await vi.advanceTimersByTimeAsync(due - 1);
      expect(fetch).toHaveBeenCalledTimes(asks);
      await vi.advanceTimersByTimeAsync(1);
      asks += 1;
      expect(fetch).toHaveBeenCalledTimes(asks);
    }
  });

  it('backs off from the first wait again once the channel was current', async () => {
    quiet();
    let up = false;
    const { runtime, fetch, frame } = setup('5', (after) => {
      if (!up) throw new Error('service unavailable');
      return changes(Number(after));
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(CATCH_UP_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    up = true;
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');

    up = false;
    frame(9);
    await debounced();
    const asks = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(CATCH_UP_RETRY_MS);
    expect(fetch).toHaveBeenCalledTimes(asks + 1);
  });

  it('lets a frame bring a backed-off retry forward', async () => {
    quiet();
    const { runtime, fetch, frame } = setup('5', () => {
      throw new Error('service unavailable');
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).rejects.toThrow();
    frame(9);
    await debounced();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('starts no retry once the last view closes', async () => {
    quiet();
    const { runtime, fetch } = setup('5', () => {
      throw new Error('service unavailable');
    });
    runtime.onConnected();
    const close = runtime.open(CHANNEL_ID);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).rejects.toThrow();
    close();
    close();
    await vi.advanceTimersByTimeAsync(CATCH_UP_RETRY_MAX_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('connections', () => {
  it('catches up the channels on screen after a reconnect', async () => {
    const { runtime, asked } = setup('5', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    runtime.onDisconnected();
    runtime.onConnected();
    await debounced();
    expect(asked()).toEqual(['5']);
  });

  it('ends a catch-up of the old connection and reads again in the new one', async () => {
    const signals: AbortSignal[] = [];
    const { runtime, asked } = setup('5', (_after, signal) => {
      signals.push(signal);
      if (signals.length > 1) return changes(8);
      return new Promise<ChannelChangesPage>(() => {});
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    runtime.onDisconnected();
    runtime.onConnected();
    await expect(open).resolves.toBe('skipped');
    expect(signals[0].aborted).toBe(true);
    await debounced();
    expect(asked()).toEqual(['5', '5']);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
  });

  it('does not mark current what a catch-up read across a connection', async () => {
    const answer = Promise.withResolvers<ChannelChangesPage>();
    const { runtime, asked } = setup('5', (after) =>
      after === '5' ? answer.promise : changes(8)
    );
    runtime.onConnected();
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    runtime.onDisconnected();
    answer.resolve(changes(6));
    await expect(open).resolves.toBe('applied');
    runtime.onConnected();
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['5', '6']);
  });

  it('asks once more for what changed before the server pushed changes over the connection', async () => {
    let head = 5;
    const { engine, runtime, asked } = setup('5', () => changes(head));
    runtime.open(CHANNEL_ID);
    runtime.onConnected();
    await debounced();
    expect(asked()).toEqual(['5']);
    // Changed after the server answered, and pushed to no one.
    head = 6;
    await vi.advanceTimersByTimeAsync(LISTENING_MS);
    await debounced();
    expect(engine.seq()).toBe('6');
    expect(asked()).toEqual(['5', '5']);
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('current');
    await vi.advanceTimersByTimeAsync(10 * LISTENING_MS);
    expect(asked()).toEqual(['5', '5']);
  });

  it('asks again, once opened, for a channel off screen read before the server pushed changes', async () => {
    const { runtime, asked } = setup('5');
    runtime.onConnected();
    await runtime.ensureCurrent(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['5']);
    await vi.advanceTimersByTimeAsync(LISTENING_MS);
    await runtime.ensureCurrent(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['5', '5']);
  });

  it('does not trust a read sent before the server surely pushed changes', async () => {
    const { runtime, read, asked } = setup('5');
    runtime.onConnected();
    const sent = runtime.epoch();
    await vi.advanceTimersByTimeAsync(LISTENING_MS);
    read('5', sent);
    await runtime.ensureCurrent(CHANNEL_ID);
    expect(asked()).toEqual(['5']);
  });

  it('forgets every channel after a storage reset', async () => {
    const { engine, runtime } = setup('5');
    runtime.onConnected();
    await runtime.ensureCurrent(CHANNEL_ID);
    engine.setSeq(null);
    runtime.forgetAll();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('not-held');
  });

  it('catches up the channels on screen and tells their views once the device is back', async () => {
    const { runtime, asked, changed } = setup('5', () => changes(8));
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    await runtime.ensureCurrent(CHANNEL_ID);
    changed.mockClear();
    runtime.resumed();
    expect(changed.mock.calls).toEqual([['resumed']]);
    await debounced();
    expect(asked()).toEqual(['5', '8']);
  });

  it('ends its requests, and starts none, once disposed', async () => {
    let signal: AbortSignal | undefined;
    const { engine, runtime, fetch, frame } = setup('5', (_after, given) => {
      signal = given;
      return new Promise<ChannelChangesPage>(() => {});
    });
    runtime.onConnected();
    runtime.open(CHANNEL_ID);
    const open = runtime.ensureCurrent(CHANNEL_ID);
    await settled();
    runtime.dispose();
    await expect(open).resolves.toBe('skipped');
    expect(signal?.aborted).toBe(true);
    expect(engine.listeners()).toBe(0);
    frame(9);
    runtime.resumed();
    await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('skipped');
    await debounced();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('changes of the device', () => {
  it('tells the views of a channel what any tab changed', () => {
    const { engine, changed } = setup('5');
    engine.push('changed');
    engine.push('reset');
    engine.push('evicted');
    expect(changed.mock.calls).toEqual([['changed'], ['reset'], ['reset']]);
  });

  it.each(['reset', 'evicted'] as const)(
    'reads the watermark again after the channel was %s',
    async (kind) => {
      const { engine, runtime } = setup('5');
      runtime.onConnected();
      await runtime.ensureCurrent(CHANNEL_ID);
      engine.setSeq(null);
      engine.push(kind);
      await expect(runtime.ensureCurrent(CHANNEL_ID)).resolves.toBe('not-held');
    }
  );

  it('keeps telling the other views when one throws', () => {
    const error = quiet();
    const { engine, runtime, changed } = setup('5');
    runtime.onChanged(CHANNEL_ID, () => {
      throw new Error('view failed');
    });
    const last = vi.fn();
    const stop = runtime.onChanged(CHANNEL_ID, last);
    engine.push('changed');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    stop();
    engine.push('changed');
    expect(last).toHaveBeenCalledTimes(1);
  });
});
