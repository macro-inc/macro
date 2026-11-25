import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import type { ChannelChangesQuery } from '@service-storage/graphql/generated/graphql';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import * as Semaphore from 'effect/Semaphore';
import type { ChannelStoreResult } from './channel-network';

export type ChannelChangesPage = ChannelChangesQuery['user']['channelChanges'];

/** What the runtime reads of a pushed timeline frame. */
export interface ChannelFrame {
  channelId: string;
  /** The change sequence the frame brings the channel to, in decimal. */
  seq: string;
}

/** The server keeps 1000 changes replayable, 200 a page. */
export const MAX_CHANGE_PAGES = 6;
/** Frames, gaps and reconnects that closely follow each other share one catch-up. */
export const CATCH_UP_DEBOUNCE_MS = 250;
/** Spread over the debounce so a busy channel's members do not ask at once. */
export const CATCH_UP_JITTER_MS = 250;
/**
 * A failed catch-up of a channel on screen is tried again after this wait,
 * doubled after each failure in a row up to the maximum.
 */
export const CATCH_UP_RETRY_MS = 2_000;
export const CATCH_UP_RETRY_MAX_MS = 60_000;
/**
 * A connection is up before the server pushes changes over it, and nothing says
 * when it does: what changes in between is in no frame. Past this wait it
 * surely does, and the channels are asked for once more.
 */
export const LISTENING_MS = 5_000;
/**
 * How long one page of a catch-up may take, stored on the device included. It
 * holds the channel's other catch-ups; past this it fails and is tried again.
 */
export const CATCH_UP_PAGE_BUDGET_MS = 30_000;

export interface ChannelSyncDeps {
  host: Pick<CacheHost, 'channelTimeline' | 'onChannelChanged'>;
  /**
   * One page of changes after `after`. Its records are stored with the
   * advance they prove; `signal` ends the request.
   */
  fetchChanges(
    channelId: string,
    after: string,
    signal: AbortSignal
  ): Promise<{ page: ChannelChangesPage; stored: Promise<ChannelStoreResult> }>;
  /**
   * Reads the channel's latest page and replaces everything the device holds
   * of the channel with it, in one step.
   */
  replaceWithLatest(
    channelId: string,
    signal: AbortSignal
  ): Promise<{ stored: Promise<ChannelStoreResult> }>;
  random?: () => number;
}

export type ChannelCatchUpOutcome =
  | 'not-held'
  | 'current'
  | 'applied'
  | 'reset'
  | 'skipped';

type CatchUpReason = 'gap' | 'reconnect' | 'open';

type ChannelState = {
  /** The device's watermark when last read; null when none is set. */
  seq: bigint | null | undefined;
  /** Counts what may have moved the watermark: the device's changes and frames. */
  moves: number;
  /** `moves` when the read that answered `seq` began. */
  readAt: number;
  /** A read of the watermark is out, to be done again if it moved meanwhile. */
  checking: boolean;
  /**
   * The newest sequence the server said it was at, asked since the socket
   * connected; past `LISTENING_MS`, every later change arrives as a frame.
   */
  serverSeq: bigint | undefined;
  /** The newest frame seen since the socket connected, held or not. */
  seenSeq: bigint | undefined;
  /** A frame came: a catch-up it asks for does not wait out a retry's delay. */
  framed: boolean;
  /** One catch-up at a time. */
  lock: Semaphore.Semaphore;
  /** Views showing the channel; only they are caught up after a gap. */
  views: number;
  /** A catch-up holds the channel. */
  running: boolean;
  /**
   * The scheduled catch-up that has not taken the channel yet, and while it
   * waits out its delay, when (`Date.now()`) it starts.
   */
  pending?: Fiber.Fiber<unknown, unknown>;
  pendingAt?: number;
  /** Every scheduled catch-up still out, pending or running. */
  scheduled: Set<Fiber.Fiber<unknown, unknown>>;
  /** Catch-ups `ensureCurrent` runs. */
  opens: Set<Fiber.Fiber<unknown, unknown>>;
  /** Catch-ups in a row that did not leave the channel current. */
  misses: number;
};

/**
 * What a view hears: something of the channel changed on the device, the
 * device replaced or dropped all it held of the channel, or its database is
 * back after an outage, during which it stored and read nothing.
 */
export type ChannelViewChange = 'changed' | 'reset' | 'resumed';

/** A read the server answered. */
export interface ChannelServerRead {
  /** The sequence the server read at. */
  readSeq: string;
  /** `epoch()` when the request was sent. */
  epoch: number;
}

export interface ChannelSyncRuntime {
  /** A pushed frame, once the device stored it or refused to. */
  onFrame(frame: ChannelFrame): void;
  /** The socket or the stream dropped: nothing held is current any more. */
  onDisconnected(): void;
  /** The stream is live again: catch up the channels on screen. */
  onConnected(): void;
  /** Whether frames are flowing, so a held, current channel needs no request. */
  connected(): boolean;
  /** A view opened the channel; returns its release. */
  open(channelId: string): () => void;
  /**
   * Changes when the socket drops, connects or surely pushes every change;
   * taken before a server read.
   */
  epoch(): number;
  /** A server read of the channel was answered. */
  noteServerRead(channelId: string, read: ChannelServerRead): void;
  /** Catches the channel up unless it is current; resolves when done. */
  ensureCurrent(channelId: string): Promise<ChannelCatchUpOutcome>;
  /** Something of the channel changed in this tab alone, such as a write's state. */
  notifyChanged(channelId: string): void;
  /** Views of a channel hear every change of it on the device. */
  onChanged(
    channelId: string,
    listener: (change: ChannelViewChange) => void
  ): () => void;
  /** Forgets every channel, such as after a storage reset. */
  forgetAll(): void;
  /**
   * The device's database is back after an outage: frames meanwhile stored
   * nothing, so the channels on screen catch up and their views read again.
   */
  resumed(): void;
  dispose(): void;
}

function parseSeq(seq: string | null): bigint | null {
  if (seq === null) return null;
  try {
    return BigInt(seq);
  } catch {
    return null;
  }
}

/** Whether the watermark was read after everything that may have moved it. */
function fresh(state: ChannelState): boolean {
  return state.readAt === state.moves;
}

/** Whether the device, at `seq`, may lack a change. */
function lacks(state: ChannelState, seq: bigint): boolean {
  if (state.serverSeq === undefined || seq < state.serverSeq) return true;
  return state.seenSeq !== undefined && seq < state.seenSeq;
}

/**
 * Keeps the device's channel copies current for one signed-in session.
 *
 * The engine decides what each answer may store and where the channel's
 * watermark stands after it; the runtime decides when to ask the server for
 * the changes the device lacks. A channel is current while the socket is
 * connected and the watermark has reached both the sequence the server said
 * it was at and the newest frame since. A frame that continues the watermark
 * needs no request. One past a gap, and a reconnect, leave the channel behind:
 * a channel on screen then catches up through `channelChanges` after a short,
 * jittered debounce, one off screen when it is opened. While the socket stays
 * connected a caught-up channel is current, so opening it again asks the
 * server nothing.
 *
 * Acknowledgements may arrive in another order than the device stored them in,
 * and another tab may lower the watermark at any time, so the watermark is
 * never taken from one: it is read from the device, again after each change
 * the device tells of, and that read decides.
 */
export function createChannelSyncRuntime(
  deps: ChannelSyncDeps
): ChannelSyncRuntime {
  const random = deps.random ?? Math.random;
  const scope = Effect.runSync(Scope.make());
  const channels = new Map<string, ChannelState>();
  const listeners = new Map<string, Set<(change: ChannelViewChange) => void>>();
  let isConnected = false;
  let socketEpoch = 0;
  let listening: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const stateOf = (channelId: string): ChannelState => {
    let state = channels.get(channelId);
    if (!state) {
      state = {
        seq: undefined,
        moves: 1,
        readAt: 0,
        checking: false,
        serverSeq: undefined,
        seenSeq: undefined,
        framed: false,
        lock: Semaphore.makeUnsafe(1),
        views: 0,
        running: false,
        scheduled: new Set(),
        opens: new Set(),
        misses: 0,
      };
      channels.set(channelId, state);
    }
    return state;
  };

  const notify = (channelId: string, change: ChannelViewChange) => {
    for (const listener of listeners.get(channelId) ?? []) {
      try {
        listener(change);
      } catch (error) {
        Telemetry.error(error, { surface: 'channel-sync' });
      }
    }
  };

  const stopChanges = deps.host.onChannelChanged(({ channelId, kind }) => {
    const state = channels.get(channelId);
    if (state) moved(channelId, state);
    notify(channelId, kind === 'changed' ? 'changed' : 'reset');
  });

  /**
   * Runs `effect` in the runtime's scope and returns its own fiber, so an
   * interrupt reaches it (runFork of a forkIn would return the fiber that
   * forked it, which is already done).
   */
  const fork = <A>(effect: Effect.Effect<A, unknown>) =>
    Effect.runSync(effect.pipe(Effect.forkIn(scope)));

  /** Asks the device for the channel's watermark. */
  const readSeq = (channelId: string, state: ChannelState) =>
    Telemetry.span('channel.read_watermark', async (span) => {
      span.setAttr('channel.id', channelId);
      const { moves } = state;
      const head = await deps.host.channelTimeline({ channelId, limit: 1 });
      const seq = head.kind === 'page' ? parseSeq(head.seq) : null;
      const superseded = moves < state.readAt;
      span.setAttr('watermark.held', seq !== null);
      span.setAttr('watermark.superseded', superseded);
      // Answered after a read that began later.
      if (!superseded) {
        state.readAt = moves;
        state.seq = seq;
      }
      return seq;
    });

  const isBehind = (state: ChannelState) =>
    typeof state.seq === 'bigint' && lacks(state, state.seq);

  const isCurrent = (state: ChannelState) =>
    isConnected &&
    fresh(state) &&
    typeof state.seq === 'bigint' &&
    !lacks(state, state.seq);

  /** Reads the watermark of a channel on screen, which catches up if behind. */
  const check = async (channelId: string, state: ChannelState) => {
    if (state.checking || state.views === 0) return;
    state.checking = true;
    do {
      let failed = false;
      try {
        if (!fresh(state)) await readSeq(channelId, state);
      } catch {
        // The catch-up asks the device again, and reports what it answers.
        failed = true;
      }
      // A running catch-up looks for itself when it ends.
      if (isConnected && !state.running) {
        const soon = state.framed || !state.pending;
        state.framed = false;
        if (soon && (failed || isBehind(state)))
          scheduleCatchUp(channelId, 'gap');
      }
      if (failed) break;
    } while (!disposed && state.views > 0 && !fresh(state));
    state.checking = false;
  };

  /** What the device held may be gone, and what came meanwhile lost. */
  const forget = (state: ChannelState) => {
    state.moves += 1;
    state.serverSeq = undefined;
    // A read out over an engine that is gone may never be answered.
    state.checking = false;
  };

  /** Something may have moved the channel's watermark. */
  const moved = (channelId: string, state: ChannelState) => {
    state.moves += 1;
    fireAndForget(check(channelId, state), 'channel-sync');
  };

  /** The server said, asked in `epoch`, that the channel is at `seq`. */
  const heard = (state: ChannelState, seq: bigint | null, epoch: number) => {
    if (seq === null || !isConnected || epoch !== socketEpoch) return;
    if (state.serverSeq === undefined || seq > state.serverSeq)
      state.serverSeq = seq;
  };

  /** Waits for the device, in a child span that says how long it took. */
  const storedIn = (
    parent: Span,
    kind: 'page' | 'reset',
    stored: Promise<ChannelStoreResult>
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const child = parent.span('channel.catch_up.store');
        child.setAttr('store.kind', kind);
        return child;
      }),
      (child) =>
        Effect.tryPromise({
          try: async () => {
            const result = await stored;
            if (!result.stored) throw result.error;
            if (!result.outcome)
              throw new Error('channel changes were not stored');
            child.setAttr('store.outcome', result.outcome.outcome);
            return result.outcome;
          },
          catch: (error) => error,
        }),
      (child, exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            child.error(Cause.squash(exit.cause));
          child.end();
        })
    );

  /**
   * A catch-up ended. One that finished behind a frame seen meanwhile runs
   * again. One that failed, or keeps finishing behind, is tried again after a
   * wait that doubles each time, so a server that cannot answer is not asked
   * at the debounce's pace. One that was ended (a new connection, dispose) is
   * not, nor one another catch-up is already scheduled after.
   */
  const settled = (
    channelId: string,
    exit: Exit.Exit<ChannelCatchUpOutcome, unknown>
  ) => {
    const state = stateOf(channelId);
    const finished = Exit.isSuccess(exit);
    // Moved since it looked: look again.
    if (!fresh(state)) fireAndForget(check(channelId, state), 'channel-sync');
    // Not what it answered: the device may have got the channel since.
    if (finished && !isBehind(state)) {
      state.misses = 0;
      return;
    }
    if (!isConnected || state.pending !== undefined) return;
    if (!finished && Cause.hasInterruptsOnly(exit.cause)) return;
    const wait = Math.min(
      CATCH_UP_RETRY_MS * 2 ** state.misses,
      CATCH_UP_RETRY_MAX_MS
    );
    const soon = finished && state.misses === 0;
    state.misses += 1;
    scheduleCatchUp(channelId, 'gap', soon ? CATCH_UP_DEBOUNCE_MS : wait);
  };

  /**
   * Catches a channel up in a `channel.catch_up` span of its own, a child of
   * `trace` when the catch-up was asked for in one: the runtime's Effect
   * spans reach no exporter, and its requests run in fibers that carry no
   * Telemetry context.
   */
  const catchUp = (
    channelId: string,
    reason: CatchUpReason,
    trace: TraceContext | undefined
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const open = () => Telemetry.span('channel.catch_up');
        return trace ? trace.run(open) : open();
      }),
      (span) =>
        catchUpIn(span, channelId, reason).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              stateOf(channelId).running = false;
              settled(channelId, exit);
            })
          )
        ),
      (span, exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit))
            span.setAttr('catch_up.outcome', exit.value);
          else if (Cause.hasInterruptsOnly(exit.cause))
            span.setAttr('catch_up.outcome', 'interrupted');
          else span.error(Cause.squash(exit.cause));
          span.end();
        })
    );

  const catchUpIn = Effect.fn('channel.catch_up')(function* (
    span: Span,
    channelId: string,
    reason: CatchUpReason
  ) {
    const state = stateOf(channelId);
    state.running = true;
    span.setAttr('channel.id', channelId);
    span.setAttr('catch_up.reason', reason);
    const epoch = socketEpoch;
    const watermark = Effect.tryPromise(() =>
      span.run(() => readSeq(channelId, state))
    ).pipe(Effect.timeout(CATCH_UP_PAGE_BUDGET_MS));
    const from = yield* watermark;
    if (from === null) return 'not-held' as const;
    if (isConnected && !lacks(state, from)) return 'current' as const;
    let after = from;
    let changes = 0;
    for (let page = 1; page <= MAX_CHANGE_PAGES; page += 1) {
      const { delta, outcome } = yield* Effect.gen(function* () {
        // Interrupted (replaced, the socket dropped, the runtime disposed),
        // the request ends with the span. What it stored stays stored, and
        // the next catch-up asks for it once more.
        const answer = yield* Effect.tryPromise((signal) =>
          span.run(() => deps.fetchChanges(channelId, after.toString(), signal))
        );
        if (answer.page.resetRequired)
          return { delta: answer.page, outcome: undefined };
        return {
          delta: answer.page,
          outcome: yield* storedIn(span, 'page', answer.stored),
        };
      }).pipe(Effect.timeout(CATCH_UP_PAGE_BUDGET_MS));
      if (!outcome) {
        const held = yield* watermark;
        if (held === null) return 'not-held' as const;
        // Another tab moved it on meanwhile: read again from where it is.
        if (held <= after) break;
        after = held;
        continue;
      }
      changes +=
        delta.messages.length +
        delta.activities.length +
        delta.removedIds.length;
      if (!delta.hasMore) heard(state, parseSeq(delta.seq), epoch);
      const gap = outcome.outcome === 'gap';
      const seq =
        gap || !delta.hasMore ? yield* watermark : parseSeq(outcome.seq);
      // Gone meanwhile (evicted or reset): nothing to catch up.
      if (seq === null) return 'not-held' as const;
      after = seq;
      // The device is behind where this page starts: a read lowered it
      // meanwhile. Read again from where it is.
      if (gap || delta.hasMore) continue;
      span.setAttr('catch_up.pages', page);
      span.setAttr('catch_up.changes', changes);
      return changes > 0 || seq !== from
        ? ('applied' as const)
        : ('current' as const);
    }
    // Too far behind to replay: what the device holds is replaced by the
    // latest page, and the views read the channel again.
    const outcome = yield* Effect.gen(function* () {
      const latest = yield* Effect.tryPromise((signal) =>
        span.run(() => deps.replaceWithLatest(channelId, signal))
      );
      return yield* storedIn(span, 'reset', latest.stored);
    }).pipe(Effect.timeout(CATCH_UP_PAGE_BUDGET_MS));
    heard(state, parseSeq(outcome.seq), epoch);
    yield* watermark;
    return 'reset' as const;
  });

  const lockedCatchUp = (
    channelId: string,
    reason: CatchUpReason,
    trace?: TraceContext,
    started?: () => void
  ) => {
    const state = stateOf(channelId);
    return state.lock
      .withPermits(1)(
        Effect.suspend(() => {
          started?.();
          return isCurrent(state)
            ? Effect.succeed('current' as ChannelCatchUpOutcome)
            : catchUp(channelId, reason, trace);
        })
      )
      .pipe(Effect.withSpan('channel.sync.locked_catch_up'));
  };

  /**
   * Catches up a channel on screen once things settle, or after `delay`. One
   * catch-up is pending at a time: a later ask leaves it in place unless it
   * would start sooner, so a busy channel's frames cannot keep postponing it,
   * and a catch-up already running finishes with the pending one after it.
   */
  const scheduleCatchUp = (
    channelId: string,
    reason: 'gap' | 'reconnect',
    delay = CATCH_UP_DEBOUNCE_MS
  ) => {
    const state = stateOf(channelId);
    if (state.views === 0 || disposed) return;
    const wait = delay + random() * CATCH_UP_JITTER_MS;
    const at = Date.now() + wait;
    if (state.pending) {
      // Waiting for the channel, or due sooner: it reads all this one would.
      if (state.pendingAt === undefined || state.pendingAt <= at) return;
      Effect.runFork(Fiber.interrupt(state.pending));
    }
    const fiber = fork(
      Effect.sleep(wait).pipe(
        Effect.andThen(() => {
          if (state.pending === fiber) state.pendingAt = undefined;
          // Closed meanwhile: the next open catches up.
          if (state.views === 0) return Effect.void;
          return lockedCatchUp(channelId, reason, undefined, () => {
            if (state.pending === fiber) state.pending = undefined;
          });
        }),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (Cause.hasInterruptsOnly(cause)) return;
            Telemetry.error(cause, { surface: 'channel-sync' });
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            state.scheduled.delete(fiber);
            if (state.pending !== fiber) return;
            state.pending = undefined;
            state.pendingAt = undefined;
          })
        )
      )
    );
    state.scheduled.add(fiber);
    state.pending = fiber;
    state.pendingAt = at;
  };

  const endScheduled = (state: ChannelState) => {
    for (const fiber of state.scheduled) Effect.runFork(Fiber.interrupt(fiber));
    state.pending = undefined;
    state.pendingAt = undefined;
  };

  /** What the server said before it surely pushed every change proves nothing. */
  const askAgain = () => {
    socketEpoch += 1;
    for (const [channelId, state] of channels) {
      state.serverSeq = undefined;
      // One already waiting asks too.
      if (!state.pending) scheduleCatchUp(channelId, 'reconnect');
    }
  };

  return {
    onFrame(frame) {
      if (disposed) return;
      const seq = parseSeq(frame.seq);
      if (seq === null) return;
      const state = stateOf(frame.channelId);
      if (state.seenSeq === undefined || seq > state.seenSeq)
        state.seenSeq = seq;
      state.framed = true;
      moved(frame.channelId, state);
    },
    onDisconnected() {
      isConnected = false;
      socketEpoch += 1;
      clearTimeout(listening);
      for (const state of channels.values()) {
        state.serverSeq = undefined;
        state.seenSeq = undefined;
        // The reconnect, or the next open, asks again.
        endScheduled(state);
      }
    },
    onConnected() {
      if (disposed) return;
      isConnected = true;
      clearTimeout(listening);
      listening = setTimeout(askAgain, LISTENING_MS);
      // A catch-up or read begun while the socket was down missed frames
      // this connection did not send: none of them marks the channel current.
      socketEpoch += 1;
      for (const [channelId, state] of channels) {
        // A request sent over the old connection may never be answered.
        endScheduled(state);
        for (const open of state.opens) Effect.runFork(Fiber.interrupt(open));
        state.misses = 0;
        scheduleCatchUp(channelId, 'reconnect');
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
    noteServerRead(channelId, read) {
      const state = stateOf(channelId);
      heard(state, parseSeq(read.readSeq), read.epoch);
      fireAndForget(check(channelId, state), 'channel-sync');
    },
    ensureCurrent(channelId) {
      if (disposed) return Promise.resolve('skipped');
      // Taken before any await: the catch-up's span is a child of the open.
      const trace = Telemetry.captureContext();
      const state = stateOf(channelId);
      // In the runtime's scope, so a new connection or dispose ends its
      // request too; an ended one reports `skipped`, and the reconnect
      // catches up a channel on screen.
      const open = fork(lockedCatchUp(channelId, 'open', trace));
      state.opens.add(open);
      return Effect.runPromise(
        Fiber.await(open).pipe(
          Effect.flatMap((exit) => {
            state.opens.delete(open);
            if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))
              return Effect.succeed('skipped' as const);
            return exit;
          })
        )
      );
    },
    notifyChanged: (channelId) => notify(channelId, 'changed'),
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
    forgetAll() {
      for (const state of channels.values()) forget(state);
    },
    resumed() {
      if (disposed) return;
      for (const [channelId, state] of channels) {
        forget(state);
        state.misses = 0;
        if (state.views === 0) continue;
        scheduleCatchUp(channelId, 'reconnect');
        notify(channelId, 'resumed');
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(listening);
      stopChanges();
      Effect.runFork(Scope.close(scope, Exit.void));
      channels.clear();
      listeners.clear();
    },
  };
}
