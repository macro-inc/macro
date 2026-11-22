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
/** Each check of a batch, primary read and delete together, ends here. */
export const DEPARTURE_CHECK_DEADLINE_MS = 20_000;
/** Primary reads in flight at once. */
const READ_CONCURRENCY = 4;

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
  ) => Promise<unknown>;
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
  /** Forgets every departure: the directory reads another cache. */
  reset(): void;
};

type Departure = {
  /** Checks still to make, as delays from the departure. */
  remaining: number[];
  at: number;
};

type Tally = {
  span: Span;
  read: number;
  joined: number;
  left: number;
  unreadable: number;
  failed: number;
};

/**
 * Checks a channel the viewer was seen leaving again a little later: a read
 * sent before the leave, or a replica read just after it, can land the
 * channel back in the cache as joined. If the cache shows it joined at a
 * check, its primary read decides: joined, it stays; left, the read writes
 * that back; no longer readable, its record is deleted. Nothing is hidden
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
    if (!departures.has(id) && departures.size >= DEPARTURES_LIMIT) return;
    departures.set(id, { remaining: [...rechecks], at: Date.now() });
  };

  const check = async (
    id: string,
    generation: string,
    tally: Tally,
    signal: AbortSignal
  ) => {
    tally.read += 1;
    let read: PrimaryChannelRead;
    try {
      read = await tally.span.run(() => deps.readFromPrimary(id, signal));
    } catch {
      read = { kind: 'failed' };
    }
    if (read.kind === 'failed') {
      tally.failed += 1;
      return;
    }
    if (read.channel?.isParticipant) {
      // In it again: nothing left to check.
      tally.joined += 1;
      departures.delete(id);
      return;
    }
    if (read.channel) {
      // The read wrote the record that shows them out.
      tally.left += 1;
      return;
    }
    tally.unreadable += 1;
    await tally.span.run(() => deps.removeUnreadable([id], generation, signal));
  };

  /** Makes every check that is due, then schedules the next. */
  const run = () => {
    timer = undefined;
    const generation = deps.generation();
    if (generation === undefined) {
      reset();
      return;
    }
    const now = Date.now();
    const state = deps.current();
    const due: string[] = [];
    for (const [id, departure] of departures) {
      if (departure.at + (departure.remaining[0] ?? 0) > now) continue;
      departure.remaining.shift();
      // Only a channel the cache shows joined again needs the primary.
      if (state.records[id]?.isParticipant) due.push(id);
      if (departure.remaining.length === 0) departures.delete(id);
    }
    if (due.length === 0) {
      schedule();
      return;
    }
    running = true;
    const lifetime = scope.signal;
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
                failed: 0,
              };
              try {
                for (let at = 0; at < due.length; at += READ_CONCURRENCY) {
                  if (lifetime.aborted) return;
                  await Promise.all(
                    due.slice(at, at + READ_CONCURRENCY).map(async (id) => {
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
                          check(id, generation, tally, signal),
                          new Promise<void>((resolve) =>
                            signal.addEventListener('abort', () => resolve(), {
                              once: true,
                            })
                          ),
                        ]);
                        if (deadline.aborted) tally.failed += 1;
                      } catch (error) {
                        if (!signal.aborted)
                          Telemetry.error(error, {
                            surface: 'channel-directory-departures',
                          });
                      }
                    })
                  );
                }
              } finally {
                span.setAttr('channel_directory.departures_due', due.length);
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

  return { observe, reset };
}
