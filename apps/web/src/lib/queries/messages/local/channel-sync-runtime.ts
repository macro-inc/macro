import type { CacheHost, ChannelCommitOutcome } from '@graphql-cache/index';
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
import { match } from 'ts-pattern';
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
  /** The device's watermark: undefined until read, null when none is set. */
  seq: bigint | null | undefined;
  /** Proven current while the socket has stayed connected. */
  current: boolean;
  /** One catch-up at a time. */
  lock: Semaphore.Semaphore;
  /** Views showing the channel; only they are caught up after a gap. */
  views: number;
  /**
   * The newest frame seen since the socket connected, held or not: a server
   * read older than it missed a change, so it cannot prove the channel current.
   */
  seenSeq: bigint | undefined;
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

/** A server read whose answer the device stored. */
export interface ChannelServerRead {
  /** The device's watermark after it stored the read. */
  seq: string | null;
  /** The sequence the server read at. */
  readSeq: string;
  /** `epoch()` when the request was sent. */
  epoch: number;
}

export interface ChannelSyncRuntime {
  /**
   * A pushed frame and what storing it came to; undefined when the device did
   * not store it.
   */
  onFrame(frame: ChannelFrame, outcome: ChannelCommitOutcome | undefined): void;
  /** The socket or the stream dropped: nothing held is current any more. */
  onDisconnected(): void;
  /** The stream is live again: catch up the channels on screen. */
  onConnected(): void;
  /** Whether frames are flowing, so a held, current channel needs no request. */
  connected(): boolean;
  /** A view opened the channel; returns its release. */
  open(channelId: string): () => void;
  /** The watermark a device read came with. */
  noteStoredSeq(channelId: string, seq: string | null): void;
  /** A server read landed: the channel is current if no change can be missing. */
  noteServerRead(channelId: string, read: ChannelServerRead): void;
  /** The socket epoch, which changes on every disconnect and connect. */
  epoch(): number;
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

/** What the device held of a channel, dropped: it is read again when needed. */
function forgetState(state: ChannelState): void {
  state.seq = undefined;
  state.current = false;
}

function parseSeq(seq: string | null): bigint | null {
  if (seq === null) return null;
  try {
    return BigInt(seq);
  } catch {
    return null;
  }
}

/**
 * Keeps the device's channel copies current for one signed-in session.
 *
 * The engine decides what each answer may store and where the channel's
 * watermark stands after it; the runtime decides when to ask the server for
 * the changes the device lacks. A frame that continues the watermark needs no
 * request. One past a gap, and a reconnect, leave the channel not current: a
 * channel on screen then catches up through `channelChanges` after a short,
 * jittered debounce, one off screen when it is opened. While the socket stays
 * connected a caught-up channel is current, so opening it again asks the
 * server nothing.
 *
 * Acknowledgements may arrive in another order than the device stored them
 * in, so the watermark known here can be too high. That costs nothing: a
 * catch-up asked from too high is refused as a gap and goes on from the
 * device's own. Only `current` must never be wrong, so it is set only by an
 * acknowledgement that fits what was known before it.
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
  let disposed = false;

  const stateOf = (channelId: string): ChannelState => {
    let state = channels.get(channelId);
    if (!state) {
      state = {
        seq: undefined,
        current: false,
        lock: Semaphore.makeUnsafe(1),
        views: 0,
        seenSeq: undefined,
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
    if (kind === 'changed') {
      notify(channelId, 'changed');
      return;
    }
    const state = channels.get(channelId);
    if (state) forgetState(state);
    notify(channelId, 'reset');
  });

  /**
   * Runs `effect` in the runtime's scope and returns its own fiber, so an
   * interrupt reaches it (runFork of a forkIn would return the fiber that
   * forked it, which is already done).
   */
  const fork = <A>(effect: Effect.Effect<A, unknown>) =>
    Effect.runSync(effect.pipe(Effect.forkIn(scope)));

  /** Reads the watermark once per channel and session. */
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
    if (finished && (state.current || exit.value === 'not-held')) {
      state.misses = 0;
      return;
    }
    if (!isConnected || state.current || state.pending !== undefined) return;
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
          Effect.onExit((exit) => Effect.sync(() => settled(channelId, exit)))
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

  /** Whether the device holds every change announced since `epoch` began. */
  const caughtUp = (state: ChannelState, seq: bigint, epoch: number) =>
    isConnected &&
    epoch === socketEpoch &&
    (state.seenSeq === undefined || state.seenSeq <= seq);

  const catchUpIn = Effect.fn('channel.catch_up')(function* (
    span: Span,
    channelId: string,
    reason: CatchUpReason
  ) {
    const state = stateOf(channelId);
    span.setAttr('channel.id', channelId);
    span.setAttr('catch_up.reason', reason);
    const epoch = socketEpoch;
    const from = yield* learnSeq(channelId, state);
    if (from === null) return 'not-held' as const;
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
      if (!outcome) break;
      changes +=
        delta.messages.length +
        delta.activities.length +
        delta.removedIds.length;
      const seq = parseSeq(outcome.seq);
      state.seq = seq;
      // Gone meanwhile (evicted or reset): nothing to catch up.
      if (seq === null) {
        state.current = false;
        return 'not-held' as const;
      }
      after = seq;
      // The device is behind where this page starts: a read lowered it
      // meanwhile. Read again from where it is.
      if (outcome.outcome === 'gap') {
        state.current = false;
        continue;
      }
      if (delta.hasMore) continue;
      state.current = caughtUp(state, seq, epoch);
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
    const seq = parseSeq(outcome.seq);
    state.seq = seq;
    state.current = seq !== null && caughtUp(state, seq, epoch);
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
          return state.current && isConnected
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

  /** Changes may be missing: the channel catches up, or will when opened. */
  const behind = (channelId: string, state: ChannelState) => {
    state.current = false;
    scheduleCatchUp(channelId, 'gap');
  };

  return {
    onFrame(frame, outcome) {
      if (disposed) return;
      const seq = parseSeq(frame.seq);
      if (seq === null) return;
      const state = stateOf(frame.channelId);
      if (state.seenSeq === undefined || seq > state.seenSeq)
        state.seenSeq = seq;
      const known = state.seq;
      // The device is past this frame already.
      if (typeof known === 'bigint' && known >= seq) return;
      const after = outcome ? parseSeq(outcome.seq) : undefined;
      match(outcome?.outcome)
        .with('applied', 'stale', () => {
          state.seq = after;
          // A frame further on than the known watermark: the two were
          // acknowledged out of order, and the device may be at either.
          if (typeof known === 'bigint' && known + 1n < seq)
            behind(frame.channelId, state);
        })
        .with('gap', () => {
          state.seq = after;
          behind(frame.channelId, state);
        })
        .with('unheld', () => {
          // Nothing held, so nothing to keep current; unless a read has set
          // the watermark since, which then lacks this frame.
          if (typeof known === 'bigint') behind(frame.channelId, state);
          else state.seq = after;
        })
        .with(undefined, () => {
          if (known !== null) behind(frame.channelId, state);
        })
        .exhaustive(() => behind(frame.channelId, state));
    },
    onDisconnected() {
      isConnected = false;
      socketEpoch += 1;
      for (const state of channels.values()) {
        state.current = false;
        state.seenSeq = undefined;
        // The reconnect, or the next open, asks again.
        endScheduled(state);
      }
    },
    onConnected() {
      if (disposed) return;
      isConnected = true;
      // A catch-up or read begun while the socket was down missed frames
      // this connection did not send: none of them marks the channel current.
      socketEpoch += 1;
      for (const [channelId, state] of channels) {
        // A request sent over the old connection may never be answered.
        endScheduled(state);
        for (const open of state.opens) Effect.runFork(Fiber.interrupt(open));
        state.misses = 0;
        if (state.views > 0 && state.seq !== null)
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
    noteStoredSeq(channelId, seq) {
      const state = stateOf(channelId);
      const read = parseSeq(seq);
      const known = state.seq;
      // Frames stored but not yet acknowledged here put the device ahead.
      const ahead = read !== null && typeof known === 'bigint' && read >= known;
      if (state.current && ahead) return;
      const lowered = state.current && read !== null;
      state.seq = read;
      state.current = false;
      // Another tab's page read at an older sequence lowered it.
      if (lowered) scheduleCatchUp(channelId, 'gap');
    },
    noteServerRead(channelId, read) {
      const state = stateOf(channelId);
      const known = state.seq;
      const seq = parseSeq(read.seq);
      const readSeq = parseSeq(read.readSeq);
      state.seq = seq;
      if (seq === null || readSeq === null) {
        state.current = false;
        return;
      }
      const fits = typeof known !== 'bigint' || known === seq;
      // Unmoved: the frames past it are on their way.
      if (state.current && known === seq) return;
      // Read while frames were flowing: every later change arrives as one,
      // unless one already went by while the device held nothing, or the
      // device kept an older watermark, with changes since then to replay.
      if (fits && readSeq <= seq && caughtUp(state, seq, read.epoch)) {
        state.current = true;
        return;
      }
      state.current = false;
      // Not sooner than a retry already waiting: a read says nothing of
      // whether the server can answer now.
      if (isConnected && !state.pending) scheduleCatchUp(channelId, 'gap');
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
      for (const state of channels.values()) forgetState(state);
    },
    resumed() {
      if (disposed) return;
      for (const [channelId, state] of channels) {
        forgetState(state);
        state.misses = 0;
        if (state.views === 0) continue;
        scheduleCatchUp(channelId, 'reconnect');
        notify(channelId, 'resumed');
      }
    },
    dispose() {
      disposed = true;
      stopChanges();
      Effect.runFork(Scope.close(scope, Exit.void));
      channels.clear();
      listeners.clear();
    },
  };
}
