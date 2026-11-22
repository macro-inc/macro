import { anyAbortSignal } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import { type Accessor, createSignal } from 'solid-js';
import { z } from 'zod';
import type { ChannelDirectoryState, PrimaryChannelRead } from './directory';
import type { DirectoryChannel } from './directory-core';

/**
 * Channels the viewer was seen leaving, or losing, in this cache storage
 * generation. A read that left the server before the removal can still land
 * the channel back in the cache as joined; the directory hides such a
 * channel until the primary says whether the viewer is in it again. Kept in
 * localStorage, so a reload that finds the stale record still hides it.
 */
const STORE_VERSION = 1;
/** How long a removal is remembered: far longer than any read in flight
 * when it happened can take to land. */
export const REMOVAL_WINDOW_MS = 10 * 60_000;
/** At most this many removals are remembered, the newest kept. */
const STORED_REMOVALS_LIMIT = 1_000;
/** At most this many channels are hidden at once; past it, a channel shows
 * as the cache has it. */
export const HELD_LIMIT = 200;
/** Primary reads of hidden channels in flight at once. */
const VERIFY_CONCURRENCY = 4;
/** Each primary read ends here, so a hidden channel never waits on one for
 * long. */
export const VERIFY_DEADLINE_MS = 20_000;
/** A channel is read on the primary at most this many times per page; past
 * it, the channel shows as the cache has it. */
export const VERIFY_ATTEMPTS = 3;

const STORED = z.object({
  generation: z.string(),
  removed: z.record(z.string(), z.number()),
});

type Stored = z.infer<typeof STORED>;

function storeKey(userId: string): string {
  return `channel-directory-removals:v${STORE_VERSION}:${userId}`;
}

function load(userId: string): Stored | undefined {
  try {
    const saved = localStorage.getItem(storeKey(userId));
    if (!saved) return undefined;
    const parsed = STORED.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function save(userId: string, stored: Stored): void {
  const key = storeKey(userId);
  try {
    if (Object.keys(stored.removed).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Without storage a reload forgets the removal; this page still holds it.
  }
}

function recent(
  removed: Readonly<Record<string, number>>,
  now: number
): Record<string, number> {
  const kept = Object.entries(removed)
    .filter(([, at]) => now - at < REMOVAL_WINDOW_MS && at <= now)
    .sort(([, left], [, right]) => right - left)
    .slice(0, STORED_REMOVALS_LIMIT);
  return Object.fromEntries(kept);
}

/** The removals in `generation` within `REMOVAL_WINDOW_MS` of `now`. */
export function recentChannelRemovals(
  userId: string,
  generation: string,
  now: number
): Readonly<Record<string, number>> {
  const stored = load(userId);
  if (stored?.generation !== generation) return {};
  return recent(stored.removed, now);
}

/** Remembers that the viewer left or lost `ids` at `now`. */
export function noteChannelRemovals(
  userId: string,
  generation: string,
  ids: readonly string[],
  now: number
): void {
  if (ids.length === 0) return;
  const removed = { ...recentChannelRemovals(userId, generation, now) };
  for (const id of ids) removed[id] = now;
  save(userId, { generation, removed: recent(removed, now) });
}

/** Forgets removals the primary showed the viewer back in. */
export function clearChannelRemovals(
  userId: string,
  generation: string,
  ids: readonly string[]
): void {
  const stored = load(userId);
  if (!stored || stored.generation !== generation) return;
  const removed = { ...stored.removed };
  for (const id of ids) delete removed[id];
  save(userId, { generation, removed });
}

export type RemovalWatchDeps = {
  userId: string;
  /** The storage generation the directory read; undefined while unknown. */
  generation: () => string | undefined;
  readFromPrimary: (
    channelId: string,
    signal?: AbortSignal
  ) => Promise<PrimaryChannelRead>;
  /** Deletes the cached records of channels the primary no longer shows the
   * viewer, checking again before it does. */
  removeUnreadable: (
    ids: readonly string[],
    generation: string,
    signal: AbortSignal
  ) => Promise<unknown>;
  /** The directory's lifetime. */
  signal: AbortSignal;
  now?: () => number;
};

export type RemovalWatch = {
  /** Follows what the directory shows. `unconfirmed` are channels the
   * network fallback has yet to decide, never taken for removals. */
  observe(
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>>
  ): void;
  /** Channels hidden until the primary decides them. */
  held: Accessor<Readonly<Record<string, true>>>;
  /** Hidden channels the primary has not decided yet, by id. */
  waiting: Accessor<Readonly<Record<string, true>>>;
  /** `state` without the hidden channels. */
  apply(state: ChannelDirectoryState): ChannelDirectoryState;
  /** Forgets everything: the directory reads another cache. */
  reset(): void;
};

const NOTHING_HELD: Readonly<Record<string, true>> = Object.freeze({});

type VerifyRound = {
  span: Span;
  held: number;
  joined: number;
  left: number;
  unreadable: number;
  failed: number;
  budget: number;
  overCap: number;
};

/**
 * Hides a channel the viewer was seen leaving that comes back joined, until
 * the primary says whether they are in it again: a read sent before the
 * removal (an event's refetch, a by-id read) lands its older answer after the
 * deletion. A channel the primary shows them in is shown and its removal
 * forgotten; one it shows them out of stays hidden until the cache follows;
 * one they can no longer read is deleted from the cache. A failed read, a
 * channel read too often, or too many hidden at once show the channel as the
 * cache has it.
 */
export function createRemovalWatch(deps: RemovalWatchDeps): RemovalWatch {
  const now = deps.now ?? Date.now;
  const [held, setHeld] = createSignal(NOTHING_HELD);
  const [waiting, setWaiting] = createSignal(NOTHING_HELD);
  let scope: string | undefined;
  let scopeController = new AbortController();
  let lastJoined: Set<string> | undefined;
  // Shown for the rest of this page, until seen leaving again.
  const released = new Set<string>();
  // Decided out of the channel against this record; kept hidden while the
  // cache holds it.
  const decided = new Map<string, DirectoryChannel | undefined>();
  const attempts = new Map<string, number>();
  const queue: string[] = [];
  const reading = new Set<string>();
  let current: ChannelDirectoryState | undefined;
  let round: VerifyRound | undefined;

  const undecided = (next: Readonly<Record<string, true>>) => {
    const open: Record<string, true> = {};
    for (const id of Object.keys(next)) if (!decided.has(id)) open[id] = true;
    return Object.keys(open).length === 0 ? NOTHING_HELD : open;
  };

  const publish = (next: Readonly<Record<string, true>>) => {
    const empty = Object.keys(next).length === 0;
    setHeld(empty ? NOTHING_HELD : next);
    setWaiting(undecided(next));
  };

  const reset = () => {
    scopeController.abort();
    scopeController = new AbortController();
    scope = undefined;
    lastJoined = undefined;
    released.clear();
    decided.clear();
    attempts.clear();
    queue.length = 0;
    reading.clear();
    current = undefined;
    // Reads it ended answer nothing.
    round?.span.end();
    round = undefined;
    publish(NOTHING_HELD);
  };

  const release = (id: string) => {
    released.add(id);
    decided.delete(id);
    const shown = held();
    if (!shown[id]) return;
    const next = { ...shown };
    delete next[id];
    publish(next);
  };

  const enqueue = (id: string) => {
    if (reading.has(id) || queue.includes(id)) return;
    queue.push(id);
  };

  /** The round of reads under way, opened with its first read. */
  const openRound = (): VerifyRound =>
    (round ??= {
      span: Telemetry.span('channel_directory.removal_verify'),
      held: 0,
      joined: 0,
      left: 0,
      unreadable: 0,
      failed: 0,
      budget: 0,
      overCap: 0,
    });

  const finishRound = () => {
    if (!round || reading.size > 0 || queue.length > 0) return;
    const { span, ...ended } = round;
    round = undefined;
    span.setAttr('channel_directory.removal_held', ended.held);
    span.setAttr('channel_directory.removal_joined', ended.joined);
    span.setAttr('channel_directory.removal_left', ended.left);
    span.setAttr('channel_directory.removal_unreadable', ended.unreadable);
    span.setAttr('channel_directory.removal_failed', ended.failed);
    span.setAttr('channel_directory.removal_budget', ended.budget);
    span.setAttr('channel_directory.removal_over_cap', ended.overCap);
    span.end();
  };

  const verify = async (id: string, generation: string) => {
    const tally = openRound();
    const used = attempts.get(id) ?? 0;
    if (used >= VERIFY_ATTEMPTS) {
      tally.budget += 1;
      release(id);
      return;
    }
    attempts.set(id, used + 1);
    tally.held += 1;
    const asked = current?.records[id];
    const lifetime = scopeController.signal;
    const signal = anyAbortSignal([
      deps.signal,
      lifetime,
      AbortSignal.timeout(VERIFY_DEADLINE_MS),
    ]);
    let read: PrimaryChannelRead;
    try {
      read = await tally.span.run(() => deps.readFromPrimary(id, signal));
    } catch {
      read = { kind: 'failed' };
    }
    if (lifetime.aborted || deps.signal.aborted) return;
    if (!held()[id]) return;
    if (read.kind === 'failed') {
      tally.failed += 1;
      release(id);
      return;
    }
    if (read.channel?.isParticipant) {
      tally.joined += 1;
      clearChannelRemovals(deps.userId, generation, [id]);
      release(id);
      return;
    }
    decided.set(id, asked);
    setWaiting(undecided(held()));
    if (read.channel) {
      tally.left += 1;
      return;
    }
    tally.unreadable += 1;
    try {
      await tally.span.run(() =>
        deps.removeUnreadable([id], generation, signal)
      );
    } catch (error) {
      if (!lifetime.aborted && !deps.signal.aborted)
        Telemetry.error(error, { surface: 'channel-directory-removals' });
    }
  };

  const pump = () => {
    const generation = scope;
    if (generation === undefined) return;
    while (reading.size < VERIFY_CONCURRENCY && queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || !held()[id]) continue;
      reading.add(id);
      const lifetime = scopeController.signal;
      fireAndForget(
        (async () => {
          try {
            await verify(id, generation);
          } finally {
            if (!lifetime.aborted) {
              reading.delete(id);
              pump();
              finishRound();
            }
          }
        })(),
        'channel-directory-removals'
      );
    }
  };

  const observe = (
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>>
  ) => {
    const generation = deps.generation();
    if (generation === undefined) {
      if (scope !== undefined || lastJoined) reset();
      return;
    }
    if (generation !== scope) {
      reset();
      scope = generation;
    }
    current = next;
    const joined = new Set(next.joined.map(({ id }) => id));
    const shown = held();
    let changed = false;
    const nextHeld: Record<string, true> = { ...shown };

    if (lastJoined) {
      const left: string[] = [];
      for (const id of lastJoined) {
        if (joined.has(id)) continue;
        const record = next.records[id];
        const gone = record
          ? !record.isParticipant
          : next.complete && !next.incomplete[id] && !unconfirmed[id];
        if (gone) left.push(id);
      }
      if (left.length > 0) {
        noteChannelRemovals(deps.userId, generation, left, now());
        for (const id of left) {
          released.delete(id);
          decided.delete(id);
        }
      }
    }

    // A hidden channel the cache no longer shows joined needs no read.
    for (const id of Object.keys(shown)) {
      if (joined.has(id)) continue;
      delete nextHeld[id];
      decided.delete(id);
      changed = true;
    }

    const arrived = [...joined].filter(
      (id) => !lastJoined?.has(id) && !nextHeld[id] && !released.has(id)
    );
    if (arrived.length > 0) {
      const removals = recentChannelRemovals(deps.userId, generation, now());
      let count = Object.keys(nextHeld).length;
      for (const id of arrived) {
        if (removals[id] === undefined) continue;
        if (count >= HELD_LIMIT) {
          released.add(id);
          openRound().overCap += 1;
          continue;
        }
        nextHeld[id] = true;
        count += 1;
        changed = true;
        enqueue(id);
      }
    }

    // A channel decided against one record is read again once the cache
    // holds another.
    for (const [id, record] of decided) {
      if (!nextHeld[id] || next.records[id] === record) continue;
      decided.delete(id);
      changed = true;
      enqueue(id);
    }

    lastJoined = joined;
    if (changed) publish(nextHeld);
    pump();
    finishRound();
  };

  return {
    observe,
    held,
    waiting,
    apply(state) {
      const hidden = held();
      if (hidden === NOTHING_HELD) return state;
      const joined = state.joined.filter(({ id }) => !hidden[id]);
      if (joined.length === state.joined.length) return state;
      const records = { ...state.records };
      for (const id of Object.keys(hidden)) delete records[id];
      return { ...state, records, joined };
    },
    reset,
  };
}
