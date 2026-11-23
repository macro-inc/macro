import type { CacheHost } from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import type { ChannelChangesQuery } from '@service-storage/graphql/generated/graphql';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import * as Semaphore from 'effect/Semaphore';
import { channelEntryKeys } from './channel-map';
import { noteChannelReset } from './channel-resets';

export type ChannelChangesPage = ChannelChangesQuery['user']['channelChanges'];

/** What the runtime reads of a pushed timeline frame. */
export interface ChannelFrame {
  channelId: string;
  /** The change sequence the frame brings the channel to, in decimal. */
  seq: string;
  removedIds: readonly string[];
}

/** The server keeps 1000 changes replayable, 200 a page. */
export const MAX_CHANGE_PAGES = 6;
/** Frames, gaps and reconnects that closely follow each other share one catch-up. */
export const CATCH_UP_DEBOUNCE_MS = 250;
/** Spread over the debounce so a busy channel's members do not ask at once. */
export const CATCH_UP_JITTER_MS = 250;
/** Frames held past a gap, waiting for the frames before them. */
const MAX_HELD_FRAMES = 50;

export type ChannelSyncHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit'
>;

export interface ChannelSyncDeps {
  host: ChannelSyncHost;
  /** One page of changes after `after`, resolved once its records are cached. */
  fetchChanges(channelId: string, after: string): Promise<ChannelChangesPage>;
  /** The cache session a write belongs to; a later session refuses it. */
  generation(): string;
  random?: () => number;
}

export type ChannelCatchUpOutcome =
  | 'not-held'
  | 'current'
  | 'applied'
  | 'reset'
  | 'skipped';

/** A frame waiting for the ones before it, with the session that stored it. */
type HeldFrame = { frame: ChannelFrame; generation: string };

type ChannelState = {
  /** Stored sequence: undefined until read, null when the device holds nothing. */
  seq: bigint | null | undefined;
  /** Proven current while the socket has stayed connected. */
  current: boolean;
  /** One write to the channel's sync state at a time. */
  lock: Semaphore.Semaphore;
  /** Frames past a gap, by sequence, applied once the gap closes. */
  held: Map<bigint, HeldFrame>;
  /**
   * Replay changes from here on the next catch-up: a frame arrived after a
   * newer one, or after the device had moved past it, so the records it wrote
   * can be older than what the device already held.
   */
  repairFrom: bigint | undefined;
  /** Views showing the channel; only they are caught up after a gap. */
  views: number;
  /**
   * The newest frame seen since the socket connected, held or not: a server
   * read older than it missed a change, so it cannot prove the channel current.
   */
  seenSeq: bigint | undefined;
  /**
   * The device has a sync row for the channel, held or not: eviction finds a
   * channel's records through it.
   */
  sweepable: boolean;
  debounce?: Fiber.Fiber<unknown, unknown>;
};

export interface ChannelSyncRuntime {
  /**
   * A pushed frame; `stored` says whether its records reached the cache, in
   * the cache session `generation` (the current one when not given).
   */
  onFrame(frame: ChannelFrame, stored: boolean, generation?: string): void;
  /** The socket or the stream dropped: nothing held is current any more. */
  onDisconnected(): void;
  /** The stream is live again: catch up the channels on screen. */
  onConnected(): void;
  /** Whether frames are flowing, so a held, current channel needs no request. */
  connected(): boolean;
  /** A view opened the channel; returns its release. */
  open(channelId: string): () => void;
  /** What a read learned about the stored sequence. */
  noteStoredSeq(channelId: string, seq: string | null): void;
  /**
   * A read fetched from the server at sequence `readSeq` and the socket epoch
   * `epoch`: the stored sequence it committed is current if the socket stayed
   * up since, and the device held no older sequence than the read. A device
   * that kept an older one also kept what changed between the two, which only
   * a catch-up replays.
   */
  noteServerRead(
    channelId: string,
    seq: string | null,
    epoch: number,
    readSeq: string | null
  ): void;
  /** The socket epoch, which changes on every disconnect. */
  epoch(): number;
  /** Catches the channel up unless it is current; resolves when done. */
  ensureCurrent(channelId: string): Promise<ChannelCatchUpOutcome>;
  /** Views of a channel hear every change the runtime applies to it. */
  onChanged(channelId: string, listener: () => void): () => void;
  notifyChanged(channelId: string): void;
  /** Forgets every channel, such as after a storage reset. */
  forgetAll(): void;
  dispose(): void;
}

const parseSeq = (seq: string | null): bigint | null => {
  if (seq === null) return null;
  try {
    return BigInt(seq);
  } catch {
    return null;
  }
};

/**
 * Keeps the device's channel copies current for one signed-in session.
 *
 * A frame that continues the stored sequence advances it with no request. A
 * gap, or a reconnect, marks the channel stale; a channel on screen then
 * catches up through `channelChanges` after a short, jittered debounce,
 * while one off screen waits until it is opened. While the socket stays
 * connected a caught-up channel is current, so opening it again asks the
 * server nothing.
 */
export function createChannelSyncRuntime(
  deps: ChannelSyncDeps
): ChannelSyncRuntime {
  const random = deps.random ?? Math.random;
  const scope = Effect.runSync(Scope.make());
  const channels = new Map<string, ChannelState>();
  const listeners = new Map<string, Set<() => void>>();
  let isConnected = false;
  let socketEpoch = 0;
  let disposed = false;

  const stateOf = (channelId: string): ChannelState => {
    let state = channels.get(channelId);
    if (!state) {
      state = {
        seq: undefined,
        current: false,
        lock: Semaphore.makeUnsafe(1),
        held: new Map(),
        repairFrom: undefined,
        views: 0,
        seenSeq: undefined,
        sweepable: false,
      };
      channels.set(channelId, state);
    }
    return state;
  };

  const notifyChanged = (channelId: string) => {
    for (const listener of listeners.get(channelId) ?? []) {
      try {
        listener();
      } catch (error) {
        Telemetry.error(error, { surface: 'channel-sync' });
      }
    }
  };

  const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(effect);

  const fork = (effect: Effect.Effect<unknown, unknown>) =>
    Effect.runFork(
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => Telemetry.error(cause, { surface: 'channel-sync' }))
        ),
        Effect.forkIn(scope)
      )
    );

  /** Reads the stored sequence once per channel and session. */
  const learnSeq = Effect.fn('channel.sync.learn_seq')(function* (
    channelId: string,
    state: ChannelState
  ) {
    if (state.seq !== undefined) return state.seq;
    const head = yield* Effect.tryPromise(() =>
      deps.host.channelTimeline({ channelId, limit: 1 })
    );
    state.seq = head.kind === 'page' ? parseSeq(head.seq) : null;
    return state.seq;
  });

  const commit = (
    channelId: string,
    args: Omit<
      Parameters<ChannelSyncHost['channelTimelineCommit']>[0],
      'channelId'
    >,
    generation: string
  ) =>
    Effect.tryPromise(() =>
      deps.host.channelTimelineCommit({ channelId, ...args }, generation)
    );

  /**
   * A frame stored records for a channel the device does not hold: an empty
   * commit gives it a sync row, untouched, so the next eviction pass takes
   * those records with it. Once per channel and runtime; a failure only
   * leaves them until the channel is opened.
   */
  const markSweepable = Effect.fn('channel.sync.mark_sweepable')(function* (
    channelId: string,
    state: ChannelState,
    generation: string
  ) {
    if (state.sweepable) return;
    state.sweepable = true;
    yield* commit(channelId, {}, generation).pipe(Effect.ignore);
  });

  /**
   * Applies the frames that now continue the stored sequence, each in the
   * session that stored its records: a later session refuses it.
   */
  const applyHeld = Effect.fn('channel.sync.apply_frames')(function* (
    channelId: string,
    state: ChannelState
  ) {
    let applied = 0;
    while (state.seq !== null && state.seq !== undefined) {
      const next = state.held.get(state.seq + 1n);
      if (!next) break;
      state.held.delete(state.seq + 1n);
      const from = state.seq;
      const committed = yield* commit(
        channelId,
        {
          removedKeys: next.frame.removedIds.flatMap(channelEntryKeys),
          seq: {
            kind: 'advance',
            from: from.toString(),
            to: (from + 1n).toString(),
          },
        },
        next.generation
      );
      if (committed.kind !== 'committed') break;
      state.seq = parseSeq(committed.channelSeq);
      applied += 1;
      // Another tab or a read moved the sequence: what is held is stale.
      if (state.seq !== from + 1n) break;
    }
    for (const seq of state.held.keys()) {
      if (state.seq !== null && state.seq !== undefined && seq <= state.seq) {
        state.held.delete(seq);
      }
    }
    return applied;
  });

  const catchUp = Effect.fn('channel.catch_up')(function* (
    channelId: string,
    reason: 'gap' | 'reconnect' | 'open'
  ) {
    const state = stateOf(channelId);
    yield* Effect.annotateCurrentSpan({
      'channel.id': channelId,
      'catch_up.reason': reason,
    });
    const epoch = socketEpoch;
    const generation = deps.generation();
    const from = yield* learnSeq(channelId, state);
    if (from === null) return 'not-held' as const;
    // A repair replays from before the frame that may have written old
    // records; the stored sequence only moves forward.
    const repair = state.repairFrom;
    let after = repair !== undefined && repair < from ? repair : from;
    let changes = 0;
    for (let page = 0; page < MAX_CHANGE_PAGES; page += 1) {
      const delta = yield* Effect.tryPromise(() =>
        deps.fetchChanges(channelId, after.toString())
      );
      if (delta.resetRequired) break;
      changes +=
        delta.messages.length +
        delta.activities.length +
        delta.removedIds.length;
      const to = parseSeq(delta.seq);
      if (to === null) break;
      const stored = state.seq ?? from;
      if (to > stored || delta.removedIds.length > 0) {
        const committed = yield* commit(
          channelId,
          {
            removedKeys: delta.removedIds.flatMap(channelEntryKeys),
            ...(to > stored && {
              seq: {
                kind: 'advance',
                from: stored.toString(),
                to: to.toString(),
              },
            }),
          },
          generation
        );
        if (committed.kind !== 'committed') break;
        state.seq = parseSeq(committed.channelSeq);
        // Gone meanwhile (evicted or reset): nothing to catch up.
        if (state.seq === null) return 'not-held' as const;
        // A read lowered the sequence meanwhile: replay from there.
        if (to > stored && state.seq !== to) {
          after = state.seq;
          continue;
        }
      }
      after = to;
      if (!delta.hasMore) {
        if (state.repairFrom === repair) state.repairFrom = undefined;
        yield* applyHeld(channelId, state);
        if (epoch === socketEpoch && isConnected) state.current = true;
        yield* Effect.annotateCurrentSpan({
          'catch_up.pages': page + 1,
          'catch_up.changes': changes,
        });
        return changes > 0 || (state.seq ?? from) !== from
          ? ('applied' as const)
          : ('current' as const);
      }
    }
    // Too far behind to replay: drop what the device holds, and the views
    // read the channel again from the server.
    noteChannelReset(deps.host, channelId);
    yield* commit(channelId, { reset: true }, generation);
    state.seq = null;
    state.held.clear();
    state.repairFrom = undefined;
    state.current = false;
    return 'reset' as const;
  });

  const lockedCatchUp = (
    channelId: string,
    reason: 'gap' | 'reconnect' | 'open'
  ) => {
    const state = stateOf(channelId);
    return state.lock
      .withPermits(1)(
        Effect.suspend(() =>
          state.current && isConnected
            ? Effect.succeed('current' as ChannelCatchUpOutcome)
            : catchUp(channelId, reason)
        )
      )
      .pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (outcome !== 'current') notifyChanged(channelId);
          })
        ),
        Effect.withSpan('channel.sync.locked_catch_up')
      );
  };

  /** Catches up a channel on screen once things settle. */
  const scheduleCatchUp = (channelId: string, reason: 'gap' | 'reconnect') => {
    const state = stateOf(channelId);
    if (state.views === 0 || disposed) return;
    if (state.debounce) Effect.runFork(Fiber.interrupt(state.debounce));
    const wait = CATCH_UP_DEBOUNCE_MS + random() * CATCH_UP_JITTER_MS;
    const fiber = fork(
      Effect.sleep(wait).pipe(
        Effect.andThen(() => lockedCatchUp(channelId, reason)),
        Effect.ensuring(
          Effect.sync(() => {
            if (state.debounce === fiber) state.debounce = undefined;
          })
        )
      )
    );
    state.debounce = fiber;
  };

  const handleFrame = Effect.fn('channel.sync.frame')(function* (
    frame: ChannelFrame,
    stored: boolean,
    generation: string
  ) {
    const channelId = frame.channelId;
    const state = stateOf(channelId);
    const seq = parseSeq(frame.seq);
    yield* Effect.annotateCurrentSpan({
      'channel.id': channelId,
      'channel.frame_seq': frame.seq,
    });
    if (seq === null) return 'not-held';
    // Behind a frame already seen: the records it wrote may be older.
    const late = state.seenSeq !== undefined && seq < state.seenSeq;
    if (state.seenSeq === undefined || seq > state.seenSeq) {
      state.seenSeq = seq;
    }
    // Ignored until known held: one device read per channel and session.
    const known = yield* state.lock.withPermits(1)(learnSeq(channelId, state));
    if (known === null) {
      if (stored) yield* markSweepable(channelId, state, generation);
      return 'not-held';
    }
    return yield* state.lock.withPermits(1)(
      Effect.gen(function* () {
        const current = state.seq;
        if (current === null || current === undefined) return 'not-held';
        if (stored && (late || seq <= current)) {
          // Its records replaced newer ones the device held: replay the
          // changes from before it, which carry each record as it is now.
          const before = seq - 1n;
          if (state.repairFrom === undefined || before < state.repairFrom) {
            state.repairFrom = before;
          }
          state.current = false;
          scheduleCatchUp(channelId, 'gap');
        }
        if (seq <= current) return 'applied-before';
        if (!stored) {
          state.current = false;
          scheduleCatchUp(channelId, 'gap');
          return 'unstored';
        }
        if (state.held.size < MAX_HELD_FRAMES) {
          state.held.set(seq, { frame, generation });
        }
        yield* applyHeld(channelId, state);
        if (state.repairFrom !== undefined) return 'repair';
        if (state.held.size > 0) {
          state.current = false;
          scheduleCatchUp(channelId, 'gap');
          return 'gap';
        }
        return 'advanced';
      })
    );
  });

  return {
    onFrame(frame, stored, generation) {
      if (disposed) return;
      fork(
        handleFrame(frame, stored, generation ?? deps.generation()).pipe(
          Effect.tap((outcome) =>
            Effect.sync(() => {
              // The frame wrote records a held window shows, edits and
              // echoes of its own sends included.
              if (stored && outcome !== 'not-held') {
                notifyChanged(frame.channelId);
              }
            })
          )
        )
      );
    },
    onDisconnected() {
      isConnected = false;
      socketEpoch += 1;
      for (const state of channels.values()) {
        state.current = false;
        state.seenSeq = undefined;
      }
    },
    onConnected() {
      if (disposed) return;
      isConnected = true;
      for (const [channelId, state] of channels) {
        if (state.views > 0 && state.seq !== null) {
          scheduleCatchUp(channelId, 'reconnect');
        }
      }
    },
    connected: () => isConnected,
    epoch: () => socketEpoch,
    open(channelId) {
      const state = stateOf(channelId);
      state.views += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.views -= 1;
      };
    },
    noteStoredSeq(channelId, seq) {
      const state = stateOf(channelId);
      state.seq = parseSeq(seq);
      if (state.seq === null) state.current = false;
    },
    noteServerRead(channelId, seq, epoch, readSeq) {
      const state = stateOf(channelId);
      state.seq = parseSeq(seq);
      const read = parseSeq(readSeq);
      if (state.seq === null || read === null || read > state.seq) {
        // Nothing stored, or the device kept rows the server has since
        // changed or deleted: only a catch-up replays those.
        state.current = false;
        return;
      }
      if (!isConnected || epoch !== socketEpoch) return;
      // Read while frames were flowing: every later change arrives as one,
      // unless one already went by while the device held nothing.
      if (state.seenSeq === undefined || state.seenSeq <= state.seq) {
        state.current = true;
        return;
      }
      state.current = false;
      scheduleCatchUp(channelId, 'gap');
    },
    ensureCurrent(channelId) {
      if (disposed) return Promise.resolve('skipped');
      return run(lockedCatchUp(channelId, 'open'));
    },
    onChanged(channelId, listener) {
      let set = listeners.get(channelId);
      if (!set) {
        set = new Set();
        listeners.set(channelId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(channelId);
      };
    },
    notifyChanged,
    forgetAll() {
      for (const state of channels.values()) {
        state.seq = undefined;
        state.current = false;
        state.held.clear();
        state.repairFrom = undefined;
        state.sweepable = false;
      }
    },
    dispose() {
      disposed = true;
      Effect.runFork(Scope.close(scope, Exit.void));
      channels.clear();
      listeners.clear();
    },
  };
}
