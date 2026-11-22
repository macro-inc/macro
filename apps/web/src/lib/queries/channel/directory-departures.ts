import { anyAbortSignal, untilAborted } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import type { ChannelDirectoryState, PrimaryChannelRead } from './directory';

/** When a channel the viewer was seen leaving is checked again, after the
 * leave: a read sent before it (an event's refetch, a by-id read, another
 * list's page) lands within seconds, and a replica read sent just after it
 * can trail it by as much. */
export const DEPARTURE_RECHECKS_MS: readonly number[] = [10_000, 60_000];
/** At most this many departures are followed at once; past it, a departure
 * is left to the lane's next pass. */
export const DEPARTURES_LIMIT = 200;
/** Each check of a batch, primary reads and delete together, ends here. */
export const DEPARTURE_CHECK_DEADLINE_MS = 20_000;
/** A round starts no batch after this long; the checks it did not start
 * stay due for the next round. */
export const DEPARTURE_ROUND_DEADLINE_MS = 60_000;
/** A check that failed, or a delete whose reread failed, is made again this
 * long later, at most `DEPARTURE_RETRIES` times; after that the lane's next
 * pass decides the channel. */
export const DEPARTURE_RETRY_MS = 30_000;
export const DEPARTURE_RETRIES = 2;
/** Primary reads in flight at once. */
const READ_CONCURRENCY = 4;
/** Reads one check makes at most while live rejoins keep landing during
 * them; past it, the check is made again later. */
const CHECK_READS = 3;

/** Aborts after `ms`, on the page's own timers (which tests drive, unlike
 * `AbortSignal.timeout`'s). `release` ends it early once the work is done,
 * aborting it too so the signals combined with it drop their listeners. */
function deadlineAfter(ms: number): {
  signal: AbortSignal;
  release: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('deadline', 'TimeoutError')),
    ms
  );
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}

/** What the cleanup of unreadable channels reports back. */
export type RemoveUnreadableResult = {
  /** Channels whose cached records were deleted. */
  removed: readonly string[];
  /** Deleted channels the read after the delete did not reach. */
  unconfirmed: readonly string[];
};

export type DepartureRecheckDeps = {
  /** The storage generation the directory reads; undefined while unknown. */
  generation: () => string | undefined;
  /** The state the directory reads now. */
  current: () => ChannelDirectoryState;
  readFromPrimary: (
    channelId: string,
    signal?: AbortSignal
  ) => Promise<PrimaryChannelRead>;
  /** Deletes the cached records of channels the primary shows the viewer can
   * no longer read, checking again before it does. */
  removeUnreadable: (
    ids: readonly string[],
    generation: string,
    signal: AbortSignal
  ) => Promise<RemoveUnreadableResult | undefined>;
  /** The directory's lifetime. */
  signal: AbortSignal;
  /** Delays after a departure, in order; `DEPARTURE_RECHECKS_MS` when left
   * out. */
  rechecksMs?: readonly number[];
};

export type DepartureRecheck = {
  /** Follows what the directory shows. `unconfirmed` are channels the
   * network fallback has yet to decide, never taken for departures. */
  observe(
    previous: ChannelDirectoryState,
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>>
  ): void;
  /** A live update showed the viewer out of the channel, or its record
   * deleted: followed even when the directory never listed it. */
  depart(channelId: string): void;
  /** A live update showed the viewer in the channel again. */
  rejoin(channelId: string): void;
  /** Forgets every departure: the directory reads another cache. */
  reset(): void;
};

type Departure = {
  /** Checks still to make, as delays from the departure. */
  remaining: number[];
  at: number;
  /** A check left the cache unsure: a delete without a confirming reread, a
   * deadline once its delete may have been sent, or rejoins during every
   * read. Read on the primary at its next check whatever the cache shows. */
  repair: boolean;
  retries: number;
  /** What saw the leave: its scan or live update parents the checks. */
  origin: TraceContext;
};

/** How one check ended, recorded on its span. */
type DepartureCheckOutcome =
  | 'joined'
  | 'left'
  | 'unreadable_cleared'
  | 'remove_skipped'
  | 'rejoined_during_check'
  | 'removed_unconfirmed'
  | 'read_failed'
  | 'remove_failed'
  | 'cancelled'
  | 'timed_out'
  | 'unfinished';

type CheckJob = {
  id: string;
  departure: Departure;
  generation: string;
  tally: Tally;
  /** Ends the check: the directory, the round's scope, or its deadline. */
  signal: AbortSignal;
  deadline: AbortSignal;
  /** Set once the delete is sent: a check that ends after it, however it
   * ends, may have deleted the record, so its retry reads the primary even
   * though the cache no longer shows the channel. */
  dispatched: boolean;
};

/** A check in flight, and whether a live update showed the viewer back in
 * the channel while it was. */
type Flight = { rejoined: boolean };

type Tally = {
  span: Span;
  read: number;
  joined: number;
  left: number;
  unreadable: number;
  unconfirmed: number;
  failed: number;
};

/**
 * Checks a channel the viewer was seen leaving again a little later: a read
 * sent before the leave, or a replica read just after it, can land the
 * channel back in the cache as joined. A leave is seen in what the directory
 * shows and in live updates, which also carry leaves of channels the
 * directory never listed. If the cache shows the channel joined at a check,
 * its primary read decides: joined, it stays; left, the read writes that
 * back; no longer readable, its record is deleted. Nothing is hidden
 * meanwhile, so such a channel shows until its check, and nothing outlives
 * the page: a departure this page saw no part of, or whose checks a closed
 * page never made, waits for the lane's next pass, which reconciles the
 * cache with the primary.
 */
export function createDepartureRecheck(
  deps: DepartureRecheckDeps
): DepartureRecheck {
  const rechecks = deps.rechecksMs ?? DEPARTURE_RECHECKS_MS;
  const departures = new Map<string, Departure>();
  const flights = new Map<string, Flight>();
  // Joined channels that went missing while the directory could not yet say
  // whether the viewer left them.
  const undecided = new Set<string>();
  let scope = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  // The generation the departures held are of.
  let followed: string | undefined;
  // The generation of the last observed state: the first state of a
  // generation is a baseline, not a change.
  let observed: string | undefined;

  const clear = () => {
    scope.abort();
    scope = new AbortController();
    departures.clear();
    flights.clear();
    undecided.clear();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    running = false;
  };
  const reset = () => {
    clear();
    followed = undefined;
    observed = undefined;
  };
  deps.signal.addEventListener('abort', reset, { once: true });

  /** The directory's generation, once the departures held are of it; a
   * leave seen before the directory has published a state of that storage
   * counts as much as one seen after. Undefined while the directory reads no
   * storage of this viewer's. */
  const follow = (): string | undefined => {
    const generation = deps.generation();
    if (deps.signal.aborted || generation === undefined) return undefined;
    if (generation !== followed) {
      // What was held was of other storage.
      clear();
      followed = generation;
    }
    return generation;
  };

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (running || deps.signal.aborted) return;
    let next = Number.POSITIVE_INFINITY;
    for (const { remaining, at } of departures.values())
      next = Math.min(next, at + (remaining[0] ?? Number.POSITIVE_INFINITY));
    if (next === Number.POSITIVE_INFINITY) return;
    timer = setTimeout(run, Math.max(0, next - Date.now()));
  };

  const depart = (id: string) => {
    const existing = departures.get(id);
    if (!existing && departures.size >= DEPARTURES_LIMIT) return;
    departures.set(id, {
      remaining: [...rechecks],
      at: Date.now(),
      repair: existing?.repair ?? false,
      retries: 0,
      // Taken while the scan or live update that saw it is still active.
      origin: Telemetry.captureContext(),
    });
  };

  /** Checks `departure` again later, unless a newer leave replaced it. */
  const retry = (id: string, departure: Departure, repair: boolean) => {
    const current = departures.get(id);
    if (current !== undefined && current !== departure) {
      if (repair) current.repair = true;
      return;
    }
    if (departure.retries >= DEPARTURE_RETRIES) return;
    if (!current && departures.size >= DEPARTURES_LIMIT) return;
    departure.retries += 1;
    if (repair) departure.repair = true;
    if (departure.remaining.length === 0)
      departure.remaining.push(Date.now() - departure.at + DEPARTURE_RETRY_MS);
    departures.set(id, departure);
  };

  const readPrimary = async (
    id: string,
    tally: Tally,
    span: Span,
    signal: AbortSignal
  ): Promise<PrimaryChannelRead> => {
    tally.read += 1;
    try {
      return await span.run(() => deps.readFromPrimary(id, signal));
    } catch {
      return { kind: 'failed' };
    }
  };

  const check = (job: CheckJob) =>
    // Parented on what saw the leave, so its trace shows the check that
    // followed it; the round is named on the span.
    job.departure.origin.run(() =>
      Telemetry.span('channel_directory.departure_check', async (span) => {
        span.setAttr('channel.id', job.id);
        const round = job.tally.span.traceparent();
        if (round) span.setAttr('channel_directory.recheck_traceparent', round);
        let outcome: DepartureCheckOutcome = 'unfinished';
        try {
          // A check that ignores its signal still ends, and frees its batch,
          // when the signal aborts.
          outcome = await untilAborted(settle(job, span), job.signal);
        } catch (error) {
          if (!job.signal.aborted) throw error;
        } finally {
          if (outcome === 'unfinished' && job.signal.aborted)
            outcome = job.deadline.aborted ? 'timed_out' : 'cancelled';
          span.setAttr('channel_directory.departure_outcome', outcome);
        }
      })
    );

  /** Reads the channel on the primary and acts on what it shows. */
  const settle = async (
    job: CheckJob,
    span: Span
  ): Promise<DepartureCheckOutcome> => {
    const { id, departure, generation, tally, signal } = job;
    const flight: Flight = { rejoined: false };
    flights.set(id, flight);
    try {
      let read: PrimaryChannelRead = { kind: 'failed' };
      // A rejoin seen while a read was out (live, in a scan or by this
      // tab's own write) can be newer than its answer, which the read has
      // already written over it: while the answer shows the viewer out,
      // read again.
      for (let reads = 0; reads < CHECK_READS; reads += 1) {
        flight.rejoined = false;
        read = await readPrimary(id, tally, span, signal);
        if (signal.aborted) return 'unfinished';
        if (
          !flight.rejoined ||
          read.kind !== 'read' ||
          read.channel?.isParticipant
        )
          break;
      }
      if (
        flight.rejoined &&
        read.kind === 'read' &&
        !read.channel?.isParticipant
      ) {
        // Rejoins kept landing during every read: check again later. The
        // last answer, written over those rejoins, can leave the cache
        // showing them out, so the next check reads the primary whatever it
        // shows.
        retry(id, departure, true);
        return 'rejoined_during_check';
      }
      if (read.kind === 'failed') {
        tally.failed += 1;
        retry(id, departure, departure.repair);
        return 'read_failed';
      }
      if (read.channel?.isParticipant) {
        // In it again: nothing left to check, unless a newer leave came in.
        tally.joined += 1;
        if (departures.get(id) === departure) departures.delete(id);
        return 'joined';
      }
      if (read.channel) {
        // The read wrote the record that shows them out.
        tally.left += 1;
        departure.repair = false;
        return 'left';
      }
      tally.unreadable += 1;
      let removed: RemoveUnreadableResult | undefined;
      try {
        job.dispatched = true;
        removed = await span.run(() =>
          deps.removeUnreadable([id], generation, signal)
        );
      } catch (error) {
        if (signal.aborted) return 'unfinished';
        tally.failed += 1;
        span.error(error);
        Telemetry.error(error, { surface: 'channel-directory-departures' });
        // The delete may have happened before it failed.
        retry(id, departure, true);
        return 'remove_failed';
      }
      if (signal.aborted) return 'unfinished';
      if (removed?.unconfirmed.includes(id)) {
        tally.unconfirmed += 1;
        tally.failed += 1;
        retry(id, departure, true);
        return 'removed_unconfirmed';
      }
      if (!removed?.removed.includes(id)) {
        // Nothing deleted: the record changed or was gone, the primary read
        // it again, the scope moved, or storage refused to owe its reread.
        // A record the cache still shows joined is checked again.
        retry(id, departure, departure.repair);
        return 'remove_skipped';
      }
      departure.repair = false;
      return 'unreadable_cleared';
    } finally {
      if (flights.get(id) === flight) flights.delete(id);
    }
  };

  /** Makes the checks that are due, then schedules the next. */
  const run = () => {
    timer = undefined;
    const generation = deps.generation();
    if (generation === undefined || generation !== followed) {
      reset();
      return;
    }
    const now = Date.now();
    const state = deps.current();
    const due: [string, Departure][] = [];
    for (const [id, departure] of departures) {
      if (departure.at + (departure.remaining[0] ?? 0) > now) continue;
      // Only a channel the cache shows joined again, or one an earlier check
      // left for repair, needs the primary.
      if (state.records[id]?.isParticipant || departure.repair) {
        due.push([id, departure]);
        continue;
      }
      departure.remaining.shift();
      if (departure.remaining.length === 0) departures.delete(id);
    }
    if (due.length === 0) {
      schedule();
      return;
    }
    running = true;
    const lifetime = scope.signal;
    const roundEnds = now + DEPARTURE_ROUND_DEADLINE_MS;
    fireAndForget(
      (async () => {
        try {
          await Telemetry.span(
            'channel_directory.departure_recheck',
            async (span) => {
              const tally: Tally = {
                span,
                read: 0,
                joined: 0,
                left: 0,
                unreadable: 0,
                unconfirmed: 0,
                failed: 0,
              };
              let started = 0;
              let outcome = 'complete';
              try {
                for (let at = 0; at < due.length; at += READ_CONCURRENCY) {
                  if (lifetime.aborted || deps.signal.aborted) {
                    outcome = 'cancelled';
                    return;
                  }
                  if (Date.now() >= roundEnds) {
                    outcome = 'deferred';
                    return;
                  }
                  const batch = due.slice(at, at + READ_CONCURRENCY);
                  await Promise.all(
                    batch.map(async ([id, departure]) => {
                      // A rejoin or a newer leave since the round began
                      // replaced it.
                      if (departures.get(id) !== departure) return;
                      // Taken only now, so a check the round never starts
                      // stays due.
                      departure.remaining.shift();
                      if (
                        departure.remaining.length === 0 &&
                        departures.get(id) === departure
                      )
                        departures.delete(id);
                      // The cache stopped showing it joined since the round
                      // began (an earlier batch's read wrote it, or a live
                      // update did): only a delete owed its read still needs
                      // the primary.
                      if (
                        !deps.current().records[id]?.isParticipant &&
                        !departure.repair
                      )
                        return;
                      started += 1;
                      const { signal: deadline, release } = deadlineAfter(
                        DEPARTURE_CHECK_DEADLINE_MS
                      );
                      const signal = anyAbortSignal([
                        deps.signal,
                        lifetime,
                        deadline,
                      ]);
                      const job: CheckJob = {
                        id,
                        departure,
                        generation,
                        tally,
                        signal,
                        deadline,
                        dispatched: false,
                      };
                      try {
                        await check(job);
                        // A reset or disposal that ended the round as well
                        // cleared what it held: nothing to put back.
                        if (
                          deadline.aborted &&
                          !lifetime.aborted &&
                          !deps.signal.aborted
                        ) {
                          tally.failed += 1;
                          retry(
                            id,
                            departure,
                            departure.repair || job.dispatched
                          );
                        }
                      } catch (error) {
                        if (!signal.aborted)
                          Telemetry.error(error, {
                            surface: 'channel-directory-departures',
                          });
                      } finally {
                        release();
                      }
                    })
                  );
                }
                if (lifetime.aborted || deps.signal.aborted)
                  outcome = 'cancelled';
              } finally {
                span.setAttr('channel_directory.departures_due', due.length);
                span.setAttr('channel_directory.departures_started', started);
                span.setAttr('channel_directory.departures_outcome', outcome);
                span.setAttr('channel_directory.departures_read', tally.read);
                span.setAttr(
                  'channel_directory.departures_joined',
                  tally.joined
                );
                span.setAttr('channel_directory.departures_left', tally.left);
                span.setAttr(
                  'channel_directory.departures_unreadable',
                  tally.unreadable
                );
                span.setAttr(
                  'channel_directory.departures_unconfirmed',
                  tally.unconfirmed
                );
                span.setAttr(
                  'channel_directory.departures_failed',
                  tally.failed
                );
              }
            }
          );
        } finally {
          if (!lifetime.aborted) {
            running = false;
            schedule();
          }
        }
      })(),
      'channel-directory-departures'
    );
  };

  const observe = (
    previous: ChannelDirectoryState,
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>>
  ) => {
    const generation = follow();
    if (generation === undefined) return;
    // The state before it may be of other storage: it says nothing about
    // what the viewer left.
    if (generation !== observed) {
      observed = generation;
      return;
    }
    if (previous.records === next.records && undecided.size === 0) return;
    // A check whose channel the directory now shows joined (a scan, or this
    // tab's own write) saw a rejoin its read may predate.
    if (previous.records !== next.records)
      for (const [id, flight] of flights)
        if (
          next.records[id]?.isParticipant &&
          !previous.records[id]?.isParticipant
        )
          flight.rejoined = true;
    const decide = (id: string) => {
      const record = next.records[id];
      if (record) {
        undecided.delete(id);
        if (!record.isParticipant) depart(id);
        return;
      }
      if (next.complete && !next.incomplete[id] && !unconfirmed[id]) {
        undecided.delete(id);
        depart(id);
      } else undecided.add(id);
    };
    for (const id of [...undecided]) decide(id);
    if (previous.records !== next.records)
      for (const { id } of previous.joined)
        if (!next.records[id]?.isParticipant) decide(id);
    schedule();
  };

  return {
    observe,
    depart(id) {
      if (follow() === undefined) return;
      undecided.delete(id);
      depart(id);
      schedule();
    },
    rejoin(id) {
      if (follow() === undefined) return;
      const flight = flights.get(id);
      if (flight) flight.rejoined = true;
      undecided.delete(id);
      const departure = departures.get(id);
      // A departure deleted without a confirming read still needs that read.
      if (departure && !departure.repair) departures.delete(id);
      schedule();
    },
    reset,
  };
}
