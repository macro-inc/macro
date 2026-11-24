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
import * as Option from 'effect/Option';
import * as Scope from 'effect/Scope';
import * as Semaphore from 'effect/Semaphore';
import { channelEntryKeys } from './channel-map';
import {
  noteChannelReset,
  onEvictedElsewhere,
  RESET_FENCE_WAIT_MS,
  whileNoFills,
} from './channel-resets';
import { onWrittenElsewhere } from './channel-tab-writes';

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
/**
 * Times a catch-up reads a page again because a newer frame stored records
 * while the page was out; past that, the next catch-up repairs from there.
 */
const MAX_PAGE_REREADS = 2;
/**
 * How long a catch-up or a frame waits for the device to take a commit.
 * It cannot be cancelled once sent, and it holds the channel: past this the
 * runtime reads the sequence from the device again.
 */
export const COMMIT_BUDGET_MS = 20_000;
/**
 * A failed catch-up of a channel on screen is tried again after this wait,
 * doubled after each failure in a row up to the maximum.
 */
export const CATCH_UP_RETRY_MS = 2_000;
export const CATCH_UP_RETRY_MAX_MS = 60_000;

export type ChannelSyncHost = Pick<
  CacheHost,
  'channelTimeline' | 'channelTimelineCommit'
>;

export interface ChannelSyncDeps {
  host: ChannelSyncHost;
  /**
   * One page of changes after `after`, resolved once its records are cached.
   * `signal` ends the request when the catch-up is interrupted.
   */
  fetchChanges(
    channelId: string,
    after: string,
    signal: AbortSignal
  ): Promise<ChannelChangesPage>;
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
/** A changes page out, and the frames that stored records while it was. */
type PageOut = { newestFrame: bigint | undefined; frames: bigint[] };

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
  /** Counts forgets, so a row write acknowledged across one marks nothing. */
  forgets: number;
  /**
   * The changes pages out for this channel, each with the newest frame that
   * stored records while it was out.
   */
  pagesOut: Set<PageOut>;
  /**
   * Frames a page read after they stored covers: it wrote their records as
   * they are now, so they need no repair.
   */
  covered: Set<bigint>;
  /**
   * The scheduled catch-up that has not taken the channel yet, and while it
   * waits out its delay, when (`Date.now()`) it starts.
   */
  pending?: Fiber.Fiber<unknown, unknown>;
  pendingAt?: number;
  /** Every scheduled catch-up still out, pending or running; a drop ends them. */
  scheduled: Set<Fiber.Fiber<unknown, unknown>>;
  /** Catch-ups `ensureCurrent` runs, which a new connection ends too. */
  opens: Set<Fiber.Fiber<unknown, unknown>>;
  /** Catch-ups that failed in a row, which set the wait before the next. */
  failures: number;
};

/**
 * What a view hears: the channel changed on the device, or the device's
 * database is back after an outage, during which it stored and read nothing.
 */
export type ChannelChange = 'changed' | 'resumed';

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
  /** The socket epoch, which changes on every disconnect and connect. */
  epoch(): number;
  /** Catches the channel up unless it is current; resolves when done. */
  ensureCurrent(channelId: string): Promise<ChannelCatchUpOutcome>;
  /** Views of a channel hear every change the runtime applies to it. */
  onChanged(
    channelId: string,
    listener: (change: ChannelChange) => void
  ): () => void;
  notifyChanged(channelId: string): void;
  /**
   * Forgets channels the device no longer holds, such as after eviction:
   * their sequence is read again, and a later frame gives them a sync row.
   */
  forget(channelIds: readonly string[]): void;
  /** Forgets every channel, such as after a storage reset. */
  forgetAll(): void;
  /**
   * The device's database is back after an outage: frames meanwhile stored
   * nothing, so the channels on screen catch up and their views read again.
   */
  resumed(): void;
  dispose(): void;
}

/**
 * Records may be older than the device's from `from` on: the next catch-up
 * replays from there, and until it does the channel is not current, so a
 * read that marked it current cannot skip that catch-up.
 */
function leaveRepair(state: ChannelState, from: bigint): void {
  if (state.repairFrom === undefined || from < state.repairFrom)
    state.repairFrom = from;
  state.current = false;
}

/** What the device held of a channel, dropped: it is read again when needed. */
function forgetState(state: ChannelState): void {
  state.seq = undefined;
  state.current = false;
  state.held.clear();
  state.repairFrom = undefined;
  state.sweepable = false;
  state.covered.clear();
  state.forgets += 1;
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
  const listeners = new Map<string, Set<(change: ChannelChange) => void>>();
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
        forgets: 0,
        pagesOut: new Set(),
        covered: new Set(),
        opens: new Set(),
        scheduled: new Set(),
        failures: 0,
      };
      channels.set(channelId, state);
    }
    return state;
  };

  const notify = (channelId: string, change: ChannelChange) => {
    for (const listener of listeners.get(channelId) ?? []) {
      try {
        listener(change);
      } catch (error) {
        Telemetry.error(error, { surface: 'channel-sync' });
      }
    }
  };

  const notifyChanged = (channelId: string) => notify(channelId, 'changed');

  const forget = (channelIds: readonly string[]) => {
    for (const channelId of channelIds) {
      const state = channels.get(channelId);
      if (!state) continue;
      forgetState(state);
      if (state.views > 0) notifyChanged(channelId);
    }
  };
  // Another tab's eviction removed these channels' sync rows too.
  const stopEvictions = onEvictedElsewhere(forget);
  // Another tab's write is on the device too: its views read it again.
  const stopWrites = onWrittenElsewhere((channelIds) => {
    for (const channelId of channelIds) notifyChanged(channelId);
  });

  const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
    Effect.runPromise(effect);

  /**
   * Runs `effect` in the runtime's scope and returns its own fiber, so an
   * interrupt reaches it (runFork of a forkIn would return the fiber that
   * forked it, which is already done).
   */
  const fork = (effect: Effect.Effect<unknown, unknown>) =>
    Effect.runSync(
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
    generation: string,
    within?: Span
  ) =>
    Effect.suspend(() => {
      // A commit runs uninterruptibly; one that would start after dispose
      // ends its fiber instead.
      if (disposed) return Effect.interrupt;
      const send = () =>
        deps.host.channelTimelineCommit({ channelId, ...args }, generation);
      return bounded(channelId, within ? within.run(send) : send());
    });

  /**
   * A catch-up's commit in a `channel.catch_up.commit` child span, so the
   * trace shows how long the device took to store each page or reset, and
   * which one went unanswered.
   */
  const inCommitSpan = <A, E, R>(
    parent: Span,
    kind: 'page' | 'reset',
    page: number,
    use: (child: Span) => Effect.Effect<A, E, R>
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const child = parent.span('channel.catch_up.commit');
        child.setAttr('commit.kind', kind);
        child.setAttr('catch_up.page', page);
        return child;
      }),
      use,
      (child, exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            child.error(Cause.squash(exit.cause));
          child.end();
        })
    );

  /**
   * Waits at most `COMMIT_BUDGET_MS` for the device to answer a commit. Left
   * unanswered, what the device holds is unknown until it is read again: the
   * channel forgets its sequence, and its views read again once the device
   * answers.
   */
  const bounded = <A>(channelId: string, pending: Promise<A>) =>
    Effect.tryPromise(() => pending).pipe(
      Effect.timeoutOption(COMMIT_BUDGET_MS),
      Effect.flatMap((answer) => {
        if (Option.isSome(answer)) return Effect.succeed(answer.value);
        const state = stateOf(channelId);
        state.seq = undefined;
        state.current = false;
        fireAndForget(
          whenAnswered(pending, () => {
            if (!disposed) notifyChanged(channelId);
          }),
          'channel-sync'
        );
        return Effect.fail(new Error('channel commit went unanswered'));
      })
    );

  const whenAnswered = async (pending: Promise<unknown>, then: () => void) => {
    await Promise.allSettled([pending]);
    then();
  };

  /**
   * A frame stored records for a channel the device does not hold: an empty
   * commit gives it a sync row, untouched, so the next eviction pass takes
   * those records with it. Once per channel until eviction removes the row;
   * a failure tries again on the next frame.
   */
  const markSweepable = Effect.fn('channel.sync.mark_sweepable')(function* (
    channelId: string,
    state: ChannelState,
    generation: string
  ) {
    if (state.sweepable) return;
    const forgets = state.forgets;
    yield* commit(channelId, {}, generation).pipe(
      Effect.tap((committed) =>
        Effect.sync(() => {
          // Only a row the device wrote: an unsupported or refused commit
          // leaves the channel to the next frame, and so does an eviction
          // heard meanwhile, which may have removed the row after it.
          if (committed.kind === 'committed' && state.forgets === forgets)
            state.sweepable = true;
        })
      ),
      Effect.ignore
    );
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

  /**
   * A catch-up ended: the views reread what it changed, an interrupted one's
   * commits included, and a repair a finished one left behind (its pages
   * kept landing under newer frames) runs once things settle. One that
   * failed is tried again after a wait that doubles with each failure in a
   * row, so a server that keeps failing is not asked at the debounce's pace;
   * one that was ended (a new connection, dispose) is not, nor one another
   * catch-up is already scheduled after.
   */
  const settled = (
    channelId: string,
    exit: Exit.Exit<ChannelCatchUpOutcome, unknown>,
    progress: { committed: boolean }
  ) => {
    const state = stateOf(channelId);
    const outcome = Exit.isSuccess(exit) ? exit.value : undefined;
    if (progress.committed || (outcome && outcome !== 'current'))
      notifyChanged(channelId);
    if (outcome) state.failures = 0;
    // Nothing held, nothing to repair.
    if (outcome === 'not-held' || outcome === 'reset')
      state.repairFrom = undefined;
    if (!isConnected || state.current || state.pending !== undefined) return;
    if (outcome) {
      if (state.repairFrom !== undefined) scheduleCatchUp(channelId, 'gap');
      return;
    }
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return;
    const wait = Math.min(
      CATCH_UP_RETRY_MS * 2 ** state.failures,
      CATCH_UP_RETRY_MAX_MS
    );
    state.failures += 1;
    scheduleCatchUp(channelId, 'gap', wait);
  };

  /**
   * Catches a channel up in a `channel.catch_up` span of its own, a child of
   * `trace` when the catch-up was asked for in one: the runtime's Effect
   * spans reach no exporter, and its requests run in fibers that carry no
   * Telemetry context.
   */
  const catchUp = (
    channelId: string,
    reason: 'gap' | 'reconnect' | 'open',
    trace: TraceContext | undefined
  ) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const open = () => Telemetry.span('channel.catch_up');
        return trace ? trace.run(open) : open();
      }),
      // Only the request can be interrupted: a commit the device takes is
      // always recorded, so the sequence and the views follow it.
      (span) =>
        Effect.uninterruptibleMask((restore) => {
          const progress = { committed: false };
          return catchUpIn(span, channelId, reason, restore, progress).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => settled(channelId, exit, progress))
            )
          );
        }),
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
    reason: 'gap' | 'reconnect' | 'open',
    interruptible: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>,
    progress: { committed: boolean }
  ) {
    const state = stateOf(channelId);
    span.setAttr('channel.id', channelId);
    span.setAttr('catch_up.reason', reason);
    const epoch = socketEpoch;
    const forgets = state.forgets;
    const generation = deps.generation();
    const from = yield* learnSeq(channelId, state);
    if (from === null) return 'not-held' as const;
    // A repair replays from before the frame that may have written old
    // records; the stored sequence only moves forward.
    const repair = state.repairFrom;
    let after = repair !== undefined && repair < from ? repair : from;
    let changes = 0;
    let rereads = 0;
    // Pages a read lowered the device under, read again without counting.
    let lowered = 0;
    // Frames that stored while a page was out: each later page that lands
    // covers those it commits through.
    const covering: bigint[] = [];
    // The lowest repair this catch-up left for an overtaken last page.
    let overtaken: bigint | undefined;
    // The repair left for the previous page, which had more after it, and the
    // newest frame that overtook it: a later page releases the repair once it
    // reaches that frame, and raises it to itself before then.
    let pageRepair: bigint | undefined;
    let pageRepairUntil: bigint | undefined;
    for (let page = 0; page < MAX_CHANGE_PAGES + rereads + lowered; page += 1) {
      // The page carries the records changed after this cursor, as they are
      // when it is read.
      const asked = after;
      // Watched until the page's commit is answered: a frame written before
      // the page can be acknowledged after the fetch settles.
      const out: PageOut = { newestFrame: undefined, frames: [] };
      const release = Effect.sync(() => state.pagesOut.delete(out));
      state.pagesOut.add(out);
      // Interrupted (replaced, the socket dropped, the runtime disposed), the
      // request ends with the span.
      const delta = yield* interruptible(
        Effect.tryPromise((signal) =>
          span.run(() => deps.fetchChanges(channelId, after.toString(), signal))
        )
      ).pipe(Effect.onError(() => release));
      const to = parseSeq(delta.seq);
      if (delta.resetRequired || to === null) {
        yield* release;
        break;
      }
      changes +=
        delta.messages.length +
        delta.activities.length +
        delta.removedIds.length;
      // A read lowered the device below the page's cursor while it was out:
      // the page lacks the changes in between, so it cannot advance from
      // there. Read again from where the device is.
      if (state.seq !== null && state.seq !== undefined && state.seq < asked) {
        yield* release;
        state.current = false;
        after = state.seq;
        // Not this catch-up's own reading: it does not spend the page budget
        // (bounded, since reads that lower the device are finite).
        if (lowered < MAX_CHANGE_PAGES) lowered += 1;
        continue;
      }
      const stored = state.seq ?? from;
      if (to <= stored && delta.removedIds.length === 0) yield* release;
      else {
        const committed = yield* inCommitSpan(span, 'page', page, (child) =>
          commit(
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
            generation,
            child
          )
        ).pipe(
          // Failed or unanswered, the commit may still have moved the device
          // to the page, whose records a newer frame's may lie under: the
          // next catch-up repairs from it, unless the channel was forgotten
          // meanwhile and is read again from scratch.
          Effect.tapError(() =>
            Effect.sync(() => {
              if (state.forgets !== forgets) return;
              if (out.newestFrame === undefined || out.newestFrame <= to)
                return;
              leaveRepair(state, to);
            })
          ),
          Effect.ensuring(release)
        );
        if (committed.kind !== 'committed') break;
        progress.committed = true;
        state.seq = parseSeq(committed.channelSeq);
        // Gone meanwhile (evicted or reset): nothing to catch up.
        if (state.seq === null) return 'not-held' as const;
        // A read moved the sequence meanwhile, a commit of removals only
        // included: the channel is not current until a replay holds. It
        // replays from the read's sequence, unless a commit of removals only
        // finds it at or past the page: the pages from there on still run.
        if (state.seq !== (to > stored ? to : stored)) {
          state.current = false;
          if (to > stored || state.seq < to) {
            after = state.seq;
            continue;
          }
        }
      }
      after = to;
      // A newer frame stored its records while the page was out, so the page
      // may have written older ones over them: read again from the page,
      // which carries each record as it is now. A page with more after it is
      // read again by the next one.
      const overtakenPage =
        out.newestFrame !== undefined && out.newestFrame > to;
      const overwritten = !delta.hasMore && overtakenPage;
      // Frames in the page's range that stored before it landed, while it or
      // an earlier page was out: the server reads the log before the records,
      // so it carries theirs as they were at the frame or later, and a newer
      // edit of them has a later frame of its own.
      covering.push(...out.frames);
      for (const seq of covering)
        if (seq > asked && seq <= to) state.covered.add(seq);
      // This page read the changes after the previous one as they are now:
      // the repair that one left holds only past this page.
      if (pageRepair !== undefined && state.repairFrom === pageRepair) {
        if (pageRepairUntil !== undefined && pageRepairUntil > to) {
          state.repairFrom = to;
          pageRepair = to;
        } else {
          state.repairFrom = undefined;
          pageRepair = undefined;
          pageRepairUntil = undefined;
        }
      } else {
        pageRepair = undefined;
        pageRepairUntil = undefined;
      }
      // Left as a repair until a page read again holds, or until the pages
      // after one with more reach the frames that overtook it, so a drop or a
      // failure before then repairs from here.
      if (overtakenPage) {
        const lowers = state.repairFrom === undefined || to < state.repairFrom;
        if (lowers || state.repairFrom === pageRepair) {
          leaveRepair(state, to);
          if (delta.hasMore) {
            pageRepair = to;
            if (
              out.newestFrame !== undefined &&
              (pageRepairUntil === undefined ||
                out.newestFrame > pageRepairUntil)
            )
              pageRepairUntil = out.newestFrame;
          } else if (overtaken === undefined || to < overtaken) overtaken = to;
        }
      }
      if (overwritten && rereads < MAX_PAGE_REREADS) {
        rereads += 1;
        continue;
      }
      if (!delta.hasMore) {
        if (state.repairFrom === repair || state.repairFrom === overtaken)
          state.repairFrom = undefined;
        // Still overwritten: the next catch-up repairs from the page.
        if (overwritten) leaveRepair(state, to);
        yield* applyHeld(channelId, state);
        if (!overwritten && epoch === socketEpoch && isConnected)
          state.current = true;
        span.setAttr('catch_up.rereads', rereads);
        span.setAttr('catch_up.pages', page + 1);
        span.setAttr('catch_up.changes', changes);
        return changes > 0 || (state.seq ?? from) !== from
          ? ('applied' as const)
          : ('current' as const);
      }
    }
    // Too far behind to replay: drop what the device holds, and the views
    // read the channel again from the server.
    noteChannelReset(deps.host, channelId);
    // Once no fill in any tab is between its store and its coverage; one
    // that holds the fence too long cannot keep the channel from resetting.
    yield* inCommitSpan(
      span,
      'reset',
      MAX_CHANGE_PAGES + rereads + lowered,
      (child) =>
        Effect.tryPromise(() =>
          whileNoFills(
            () => {
              const pending = child.run(() =>
                deps.host.channelTimelineCommit(
                  { channelId, reset: true },
                  generation
                )
              );
              // Counted again once it answers, for a fill that read after the
              // fence let it go.
              fireAndForget(
                whenAnswered(pending, () =>
                  noteChannelReset(deps.host, channelId)
                ),
                'channel-sync'
              );
              // Bounded like any commit, so an unanswered one frees the channel.
              return run(bounded(channelId, pending));
            },
            { orRun: true, waitMs: RESET_FENCE_WAIT_MS }
          )
        )
    );
    state.seq = null;
    state.held.clear();
    state.repairFrom = undefined;
    state.current = false;
    return 'reset' as const;
  });

  const lockedCatchUp = (
    channelId: string,
    reason: 'gap' | 'reconnect' | 'open',
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
   * and a catch-up already running finishes (its pages are read again when a
   * frame stores records under them) with the pending one after it.
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
      if (stored) {
        yield* state.lock.withPermits(1)(
          markSweepable(channelId, state, generation)
        );
      }
      return 'not-held';
    }
    return yield* state.lock.withPermits(1)(
      Effect.gen(function* () {
        const current = state.seq;
        if (current === null || current === undefined) return 'not-held';
        // Read again by its catch-up after it stored: nothing to repair.
        const covered = state.covered.delete(seq) && !late;
        if (stored && !covered && (late || seq <= current)) {
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
        const appliedHeld = yield* applyHeld(channelId, state).pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              Telemetry.error(cause, { surface: 'channel-sync' });
              return false;
            })
          )
        );
        // The frame left the held set but did not advance the sequence: a
        // catch-up replays it.
        if (!appliedHeld) {
          state.current = false;
          scheduleCatchUp(channelId, 'gap');
          return 'gap';
        }
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
      // Told at once, not from the frame's fiber: a changes page that lands
      // after this frame's records may have written older ones over them.
      const seq = stored ? parseSeq(frame.seq) : null;
      if (seq !== null) {
        for (const out of channels.get(frame.channelId)?.pagesOut ?? []) {
          out.frames.push(seq);
          if (out.newestFrame === undefined || seq > out.newestFrame)
            out.newestFrame = seq;
        }
      }
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
          ),
          // However the frame ended, a page that covered it has been heard.
          Effect.ensuring(
            Effect.sync(() => {
              if (seq !== null)
                channels.get(frame.channelId)?.covered.delete(seq);
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
        // A changes page read before the drop can land after a frame of the
        // next connection and write older records over it: end it, and the
        // reconnect, or the next open, reads from the stored sequence.
        for (const fiber of state.scheduled)
          Effect.runFork(Fiber.interrupt(fiber));
        state.pending = undefined;
        state.pendingAt = undefined;
        state.covered.clear();
      }
    },
    onConnected() {
      if (disposed) return;
      isConnected = true;
      // A catch-up or read begun while the socket was down missed frames
      // this connection did not send: none of them marks the channel current.
      socketEpoch += 1;
      for (const [channelId, state] of channels) {
        // A channel opened while the socket was down still catches up over
        // HTTP; a request it has out now could land after the new
        // connection's frames, so it ends and the reconnect replaces it.
        for (const open of state.opens) Effect.runFork(Fiber.interrupt(open));
        state.failures = 0;
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
      const before = state.seq;
      state.seq = parseSeq(seq);
      const read = parseSeq(readSeq);
      if (state.seq === null || read === null || read > state.seq) {
        // Nothing stored, or the device kept rows the server has since
        // changed or deleted: only a catch-up replays those.
        state.current = false;
        if (state.seq !== null && isConnected && !state.pending)
          scheduleCatchUp(channelId, 'gap');
        return;
      }
      if (!isConnected || epoch !== socketEpoch) {
        // Read under an earlier connection, it proves nothing; one that moved
        // the device stored an older snapshot over what a catch-up since
        // applied, which only another catch-up replays.
        if (state.seq !== before) {
          state.current = false;
          if (isConnected && !state.pending) scheduleCatchUp(channelId, 'gap');
        }
        return;
      }
      // Read while frames were flowing: every later change arrives as one,
      // unless one already went by while the device held nothing, or a
      // repair is left for records outside what the read covered.
      if (
        state.repairFrom === undefined &&
        (state.seenSeq === undefined || state.seenSeq <= state.seq)
      ) {
        state.current = true;
        return;
      }
      state.current = false;
      scheduleCatchUp(channelId, 'gap');
    },
    ensureCurrent(channelId) {
      if (disposed) return Promise.resolve('skipped');
      // Taken before any await: the catch-up's span is a child of the open.
      const trace = Telemetry.captureContext();
      const state = stateOf(channelId);
      // In the runtime's scope, so a new connection or dispose ends its
      // request too; an ended one reports `skipped`, and the reconnect
      // catches up a channel on screen.
      const open = Effect.runSync(
        lockedCatchUp(channelId, 'open', trace).pipe(Effect.forkIn(scope))
      );
      state.opens.add(open);
      return run(
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
    forget,
    forgetAll() {
      for (const state of channels.values()) forgetState(state);
    },
    resumed() {
      if (disposed) return;
      for (const [channelId, state] of channels) {
        forgetState(state);
        state.failures = 0;
        if (state.views === 0) continue;
        scheduleCatchUp(channelId, 'reconnect');
        notify(channelId, 'resumed');
      }
    },
    dispose() {
      disposed = true;
      stopEvictions();
      stopWrites();
      Effect.runFork(Scope.close(scope, Exit.void));
      channels.clear();
      listeners.clear();
    },
  };
}
