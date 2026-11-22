import { anyAbortSignal } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
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

/** What the cleanup of unreadable channels reports back. */
export type RemoveUnreadableResult = {
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
  /** Deleted without a confirming reread: read on the primary at its next
   * check even though the cache no longer shows it. */
  repair: boolean;
  retries: number;
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
  // The generation the last observed states were of.
  let observed: string | undefined;

  const reset = () => {
    scope.abort();
    scope = new AbortController();
    departures.clear();
    flights.clear();
    undecided.clear();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    running = false;
  };
  deps.signal.addEventListener('abort', reset, { once: true });

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
    signal: AbortSignal
  ): Promise<PrimaryChannelRead> => {
    tally.read += 1;
    try {
      return await tally.span.run(() => deps.readFromPrimary(id, signal));
    } catch {
      return { kind: 'failed' };
    }
  };

  const check = async (
    id: string,
    departure: Departure,
    generation: string,
    tally: Tally,
    signal: AbortSignal
  ) => {
    const flight: Flight = { rejoined: false };
    flights.set(id, flight);
    try {
      let read = await readPrimary(id, tally, signal);
      if (signal.aborted) return;
      // A rejoin seen while the read was out can be newer than the answer,
      // and a left answer writes over it: read once more.
      if (
        flight.rejoined &&
        read.kind === 'read' &&
        !read.channel?.isParticipant
      ) {
        read = await readPrimary(id, tally, signal);
        if (signal.aborted) return;
      }
      if (read.kind === 'failed') {
        tally.failed += 1;
        retry(id, departure, departure.repair);
        return;
      }
      if (read.channel?.isParticipant) {
        // In it again: nothing left to check, unless a newer leave came in.
        tally.joined += 1;
        if (departures.get(id) === departure) departures.delete(id);
        return;
      }
      if (read.channel) {
        // The read wrote the record that shows them out.
        tally.left += 1;
        departure.repair = false;
        return;
      }
      tally.unreadable += 1;
      let removed: RemoveUnreadableResult | undefined;
      try {
        removed = await tally.span.run(() =>
          deps.removeUnreadable([id], generation, signal)
        );
      } catch (error) {
        if (signal.aborted) return;
        tally.failed += 1;
        Telemetry.error(error, { surface: 'channel-directory-departures' });
        retry(id, departure, departure.repair);
        return;
      }
      if (signal.aborted) return;
      if (removed?.unconfirmed.includes(id)) {
        tally.unconfirmed += 1;
        tally.failed += 1;
        retry(id, departure, true);
        return;
      }
      departure.repair = false;
    } finally {
      if (flights.get(id) === flight) flights.delete(id);
    }
  };

  /** Makes the checks that are due, then schedules the next. */
  const run = () => {
    timer = undefined;
    const generation = deps.generation();
    if (generation === undefined) {
      reset();
      return;
    }
    const now = Date.now();
    const state = deps.current();
    const due: [string, Departure][] = [];
    for (const [id, departure] of departures) {
      if (departure.at + (departure.remaining[0] ?? 0) > now) continue;
      // Only a channel the cache shows joined again, or one deleted without
      // a confirming read, needs the primary.
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
                  started += batch.length;
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
                      const deadline = AbortSignal.timeout(
                        DEPARTURE_CHECK_DEADLINE_MS
                      );
                      const signal = anyAbortSignal([
                        deps.signal,
                        lifetime,
                        deadline,
                      ]);
                      try {
                        // A check that ignores its signal still frees the
                        // batch at its deadline.
                        await Promise.race([
                          check(id, departure, generation, tally, signal),
                          new Promise<void>((resolve) =>
                            signal.addEventListener('abort', () => resolve(), {
                              once: true,
                            })
                          ),
                        ]);
                        if (deadline.aborted) {
                          tally.failed += 1;
                          retry(id, departure, departure.repair);
                        }
                      } catch (error) {
                        if (!signal.aborted)
                          Telemetry.error(error, {
                            surface: 'channel-directory-departures',
                          });
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
    const generation = deps.generation();
    if (deps.signal.aborted || generation === undefined) return;
    // A state of other storage says nothing about what the viewer left.
    if (generation !== observed) {
      reset();
      observed = generation;
      return;
    }
    if (previous.records === next.records && undecided.size === 0) return;
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

  /** Whether live updates are for the storage the directory reads. */
  const following = () =>
    !deps.signal.aborted &&
    observed !== undefined &&
    deps.generation() === observed;

  return {
    observe,
    depart(id) {
      if (!following()) return;
      undecided.delete(id);
      depart(id);
      schedule();
    },
    rejoin(id) {
      if (!following()) return;
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
