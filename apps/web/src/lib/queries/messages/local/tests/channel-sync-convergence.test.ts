import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChannelStoreResult } from '../channel-network';
import { createChannelSyncRuntime } from '../channel-sync-runtime';
import { channelEngine } from './channel-engine';
import { CHANNEL_ID } from './fixtures';

const SEEDS = 1000;
const STEPS = 60;
/** How many changes the server keeps replayable. */
const REPLAYABLE = 15;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** mulberry32 */
function generator(seed: number) {
  let state = Math.imul(seed, 2654435761);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One channel on a server that keeps changing it, followed by this tab over a
 * socket that drops, while other tabs store older pages, replace or evict it.
 * Every request, commit and acknowledgement is held for a random while, and
 * some fail. Once the server falls quiet and everything held is let go, the
 * device must have every change with nothing left to ask for.
 */
async function follow(seed: number) {
  const random = generator(seed);
  const below = (count: number) => Math.floor(random() * count);
  let head = 20;
  const engine = channelEngine(random() < 0.8 ? String(15 + below(6)) : null);
  const held: (() => void)[] = [];
  let draining = false;
  const wait = () =>
    draining || random() < 0.5
      ? undefined
      : new Promise<void>((resolve) => held.push(resolve));
  const letGo = () => held.splice(below(held.length), 1)[0]?.();
  const maybeFail = (odds: number, what: string) => {
    if (!draining && random() < odds) throw new Error(`${what} failed`);
  };
  const commit = async (
    args: Omit<Parameters<typeof engine.apply>[0], 'channelId'>
  ): Promise<ChannelStoreResult> => {
    await wait();
    const outcome = engine.apply({ channelId: CHANNEL_ID, ...args });
    await wait();
    return { stored: true, outcome };
  };
  const lower = (seq: number) =>
    commit({ seq: String(seq), watermark: { kind: 'lower' } });

  let connected = false;
  // The server pushes changes a while after the socket connected.
  let listening = false;
  let listen: ReturnType<typeof setTimeout> | undefined;
  const runtime = createChannelSyncRuntime({
    host: {
      ...engine.host,
      async channelTimeline() {
        await wait();
        maybeFail(0.05, 'device read');
        const answer = await engine.host.channelTimeline();
        await wait();
        return answer;
      },
    },
    async fetchChanges(_channelId, after, signal) {
      await wait();
      maybeFail(0.1, 'request');
      const seq = String(Math.max(head, Number(after)));
      const resetRequired = Number(after) < head - REPLAYABLE;
      await wait();
      signal.throwIfAborted();
      return {
        page: {
          resetRequired,
          seq,
          hasMore: false,
          removedIds: [],
          messages: [],
          activities: [],
        },
        stored: resetRequired
          ? Promise.resolve({ stored: true, outcome: undefined })
          : commit({ seq, watermark: { kind: 'advance', from: after } }),
      };
    },
    async replaceWithLatest() {
      await wait();
      const seq = String(head);
      await wait();
      return { stored: commit({ seq, reset: true }) };
    },
    random: () => 0,
  });

  // A view loads from the server what the device does not hold.
  let close: (() => void) | undefined;
  let reading = false;
  let missed = false;
  const read = async () => {
    if (!close) return;
    missed = true;
    if (reading) return;
    reading = true;
    while (missed) {
      missed = false;
      await wait();
      if (engine.seq() !== null || !connected) continue;
      const epoch = runtime.epoch();
      const readSeq = head;
      await wait();
      await lower(readSeq);
      runtime.noteServerRead(CHANNEL_ID, { readSeq: String(readSeq), epoch });
    }
    reading = false;
  };
  const ensure = async () => {
    try {
      return await runtime.ensureCurrent(CHANNEL_ID);
    } catch {
      return 'failed';
    }
  };
  const open = () => {
    close = runtime.open(CHANNEL_ID);
    fireAndForget(read(), 'test');
    fireAndForget(ensure(), 'test');
  };
  runtime.onChanged(CHANNEL_ID, read);
  const connect = () => {
    connected = true;
    listen = setTimeout(() => {
      listening = true;
    }, below(2000));
    runtime.onConnected();
    fireAndForget(read(), 'test');
  };
  // Frames are stored one after another, and told in any order.
  let stream = Promise.resolve();
  const push = (seq: number) => {
    const earlier = stream;
    const store = async () => {
      await earlier;
      await wait();
      engine.apply({
        channelId: CHANNEL_ID,
        seq: String(seq),
        watermark: { kind: 'advance', from: String(seq - 1) },
      });
    };
    const tell = async () => {
      await stored;
      await wait();
      runtime.onFrame({ channelId: CHANNEL_ID, seq: String(seq) });
    };
    const stored = store();
    stream = stored;
    return tell();
  };

  const steps: [number, () => unknown][] = [
    [
      28,
      () => {
        head += 1;
        return listening && push(head);
      },
    ],
    [8, () => lower(head - below(8))],
    [4, () => commit({ seq: String(head - below(6)), reset: true })],
    [
      3,
      () => {
        engine.setSeq(null);
        engine.push('evicted');
      },
    ],
    [
      4,
      () => {
        if (!connected) return connect();
        connected = false;
        listening = false;
        clearTimeout(listen);
        runtime.onDisconnected();
      },
    ],
    [
      2,
      () => {
        if (!close) return open();
        close();
        close = undefined;
      },
    ],
    [
      2,
      () => {
        runtime.forgetAll();
        runtime.resumed();
      },
    ],
    [24, letGo],
    [25, () => vi.advanceTimersByTimeAsync(below(600))],
  ];
  const step = () => {
    let left = below(100);
    for (const [weight, run] of steps) {
      left -= weight;
      if (left < 0) return run();
    }
  };

  connect();
  open();
  for (let count = 0; count < STEPS; count += 1) {
    // What it started may be held, so only the clock is waited for.
    step();
    await vi.advanceTimersByTimeAsync(0);
  }
  if (!connected) connect();
  if (!close) open();
  draining = true;
  while (held.length > 0) {
    letGo();
    await vi.advanceTimersByTimeAsync(0);
  }
  await vi.advanceTimersByTimeAsync(300_000);
  const left = {
    device: engine.seq(),
    timers: vi.getTimerCount(),
    open: await ensure(),
  };
  runtime.dispose();
  return { left, head: String(head) };
}

it('ends with every change on the device, whatever order answers come in', async () => {
  vi.useFakeTimers();
  vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const { left, head } = await follow(seed);
    expect(left, `seed ${seed}`).toEqual({
      device: head,
      timers: 0,
      open: 'current',
    });
  }
}, 30_000);
