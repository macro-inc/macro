/**
 * Channels the viewer just changed, as the primary database showed them
 * right after the write. Both directories trail a write: the in-memory pages
 * take seconds to read again, and the cache waits for the server's soup
 * update. A directory lays each write over what it read until its own source
 * shows the same channel or a later update of it, or the hold ends. Once a
 * source has, the write is let go for every directory: what the channel does
 * next (a deletion, a rejoin, someone else's rename) is the source's to show,
 * never a lag the write covers. A directory watches each channel from the
 * moment its read is sent, so what its source shows while the read is in
 * flight counts as shown after the write too.
 */
import type { QueryClient } from '@tanstack/solid-query';
import { type Accessor, createSignal, untrack } from 'solid-js';
import type { QueryAccount } from '../auth/account-scope';
import { type DirectoryChannel, instantMicros } from './directory-core';

/** How long a write stays over a source that has not caught up with it. */
export const OWN_WRITE_HOLD_MS = 60_000;

export type OwnChannelWrite = {
  /** The channel as the primary read it after the write; null once the
   * viewer can no longer read it (they deleted it, or lost access). */
  channel: DirectoryChannel | null;
  /** Whose write it was, in which sign-in: a directory of another account,
   * or of the same viewer signed in again, ignores it. */
  account: QueryAccount;
  /** When its read of the primary was sent, in the store's order: a read
   * of the channel sent later replaces it, and one sent earlier never does. */
  sequence: number;
};

/** A read of the primary sent and not settled yet. */
type OwnWriteRead = {
  sequence: number;
  account: QueryAccount;
  channelIds: readonly string[];
};

/** A read of the primary, sent. */
type SentOwnWriteRead = {
  sequence: number;
  /** Holds what the read found, by channel id (null for a channel the
   * viewer can no longer read), as writes of its sequence, and ends the
   * read. Only the first call counts; a channel left out gets no write. */
  settle: (channels: Readonly<Record<string, DirectoryChannel | null>>) => void;
};

export type OwnChannelWrites = {
  /** The writes held now, by channel id. */
  writes: Accessor<Readonly<Record<string, OwnChannelWrite>>>;
  /** The reads in flight. Not reactive: a directory reads it when its own
   * source changes, which is all it has to watch while they are. */
  inFlight: () => readonly OwnWriteRead[];
  /** Starts a read of `channelIds` for `account`, ordered after every read
   * sent before it. Its writes are held for `OWN_WRITE_HOLD_MS` in place of
   * their channel's last; one is dropped when the store already took a
   * read of its channel sent later, or was cleared since it was sent. */
  send: (
    account: QueryAccount,
    channelIds: readonly string[]
  ) => SentOwnWriteRead;
  /** Lets each write go before its hold ends, unless a later write of its
   * channel replaced it, all in one change: a bulk deletion lets thousands
   * go at once. */
  release: (released: readonly (readonly [string, OwnChannelWrite])[]) => void;
  /** Keeps the writes of the read sent at `sequence` past the end of their
   * hold until the returned retention is let go: a refresh still owes the
   * read that would show them. A source showing a write still lets it go.
   * The retention's signal aborts once it is let go, once none of those
   * writes is held any longer (a later read replaced them all, or they were
   * let go), or when the store clears. */
  retain: (sequence: number) => OwnWriteRetention;
  /** Lets every write go, drops the reads still in flight, and forgets the
   * order of every read sent so far: the storage the directories read was
   * replaced, or a new sign-in replaced the one that wrote. No read sent
   * before it is taken after it. */
  clear: () => void;
};

/** A hold kept past its end; see `OwnChannelWrites.retain`. */
export type OwnWriteRetention = {
  /** Ends the retention, letting its writes go if their hold already
   * ended. Only the first call counts. */
  release: () => void;
  /** Aborted once the retention ends, here or by a clear. */
  signal: AbortSignal;
};

const OWN_WRITES = new WeakMap<QueryClient, OwnChannelWrites>();

/** The viewer's own channel writes, held for `client`'s directories. One
 * store per query client: the writes land from mutation callbacks, outside
 * any component, and the client is the owner they share with the queries
 * the directories read. */
export function ownChannelWrites(client: QueryClient): OwnChannelWrites {
  const existing = OWN_WRITES.get(client);
  if (existing) return existing;
  const [writes, setWrites] = createSignal<
    Readonly<Record<string, OwnChannelWrite>>
  >({});
  // One hold per read that took writes, however many channels it named,
  // with the writes it holds. A hold ends early once none of them is held.
  const holds = new Map<
    ReturnType<typeof setTimeout>,
    readonly (readonly [string, OwnChannelWrite])[]
  >();
  // The latest read taken for each channel, kept after its write goes while
  // a read sent before it is still in flight, so that read can never land
  // later. A clear forgets it: every read sent before the clear is dropped
  // anyway (`clearedAt`).
  const latest = new Map<string, number>();
  const inFlight = new Map<number, OwnWriteRead>();
  // Retentions by the sequence of the read whose writes they keep, and the
  // writes whose hold ended while one was kept.
  const retained = new Map<number, Set<AbortController>>();
  const expired = new Map<
    number,
    readonly (readonly [string, OwnChannelWrite])[]
  >();
  let sequence = 0;
  let clearedAt = 0;
  // The sequences of the reads whose writes the store still holds.
  const heldSequences = () =>
    new Set(Object.values(untrack(writes)).map((write) => write.sequence));
  // Ends the holds and retentions whose writes all went or were replaced,
  // and forgets the order of channels no read in flight was sent before.
  const sweep = () => {
    const held = untrack(writes);
    for (const [hold, taken] of holds) {
      if (taken.some(([channelId, write]) => held[channelId] === write))
        continue;
      clearTimeout(hold);
      holds.delete(hold);
    }
    // A retention keeps nothing once no write of its read is held: ending it
    // stops whatever waits to let it go.
    const sequences = heldSequences();
    for (const [at, kept] of retained) {
      if (sequences.has(at)) continue;
      retained.delete(at);
      expired.delete(at);
      for (const retention of kept) retention.abort();
    }
    let oldest = Number.POSITIVE_INFINITY;
    for (const read of inFlight.values())
      oldest = Math.min(oldest, read.sequence);
    for (const [channelId, taken] of latest)
      if (taken < oldest) latest.delete(channelId);
  };
  const release = (
    released: readonly (readonly [string, OwnChannelWrite])[]
  ) => {
    const held = untrack(writes);
    const gone = released.filter(
      ([channelId, write]) => held[channelId] === write
    );
    if (gone.length === 0) return;
    setWrites((previous) => {
      const rest = { ...previous };
      for (const [channelId] of gone) delete rest[channelId];
      return rest;
    });
    sweep();
  };
  const record = (read: OwnWriteRead, found: SettledChannels) => {
    if (read.sequence <= clearedAt) return;
    const taken: [string, OwnChannelWrite][] = [];
    for (const [channelId, channel] of Object.entries(found)) {
      if ((latest.get(channelId) ?? 0) > read.sequence) continue;
      latest.set(channelId, read.sequence);
      taken.push([
        channelId,
        { channel, account: read.account, sequence: read.sequence },
      ]);
    }
    if (taken.length === 0) return;
    // A write a later read replaced is no longer held when this ends, so
    // the release passes over it.
    const hold = setTimeout(() => {
      holds.delete(hold);
      if (retained.has(read.sequence)) expired.set(read.sequence, taken);
      else release(taken);
    }, OWN_WRITE_HOLD_MS);
    holds.set(hold, taken);
    setWrites((previous) => {
      const next = { ...previous };
      for (const [channelId, write] of taken) next[channelId] = write;
      return next;
    });
  };
  const created: OwnChannelWrites = {
    writes,
    inFlight: () => [...inFlight.values()],
    send(account, channelIds) {
      sequence += 1;
      const read = { sequence, account, channelIds: [...channelIds] };
      inFlight.set(read.sequence, read);
      return {
        sequence: read.sequence,
        settle(found) {
          if (!inFlight.delete(read.sequence)) return;
          record(read, found);
          sweep();
        },
      };
    },
    release,
    retain(at) {
      const retention = new AbortController();
      // Cleared since, or none of its writes is still held: nothing to keep.
      if (at <= clearedAt || !heldSequences().has(at)) {
        retention.abort();
        return { release() {}, signal: retention.signal };
      }
      const kept = retained.get(at) ?? new Set();
      kept.add(retention);
      retained.set(at, kept);
      return {
        signal: retention.signal,
        release() {
          if (!kept.delete(retention)) return;
          retention.abort();
          if (kept.size > 0 || retained.get(at) !== kept) return;
          retained.delete(at);
          const ended = expired.get(at);
          expired.delete(at);
          if (ended) release(ended);
        },
      };
    },
    clear() {
      clearedAt = sequence;
      inFlight.clear();
      const retentions = [...retained.values()].flatMap((kept) => [...kept]);
      retained.clear();
      expired.clear();
      for (const retention of retentions) retention.abort();
      for (const hold of holds.keys()) clearTimeout(hold);
      holds.clear();
      latest.clear();
      if (Object.keys(untrack(writes)).length > 0) setWrites({});
    },
  };
  OWN_WRITES.set(client, created);
  return created;
}

/** Forgets `client`'s own writes, the reads in flight and their hold timers,
 * if it has a store: a new sign-in replaced the one that made them. Creates
 * nothing for a client no directory has read. */
export function forgetOwnChannelWrites(client: QueryClient) {
  OWN_WRITES.get(client)?.clear();
}

type SettledChannels = Readonly<Record<string, DirectoryChannel | null>>;

/** What one directory has seen of a channel since a read of it was sent:
 * whether its source showed a record of it, since when the writer was in
 * the first one it showed (`baseline`), since when they were in the last
 * one that listed them in it (`lastJoined`), and whether, before it showed
 * any record, it showed them out of the channel by lacking it while it
 * listed every channel they joined (`shownGone`). */
export type WriteSighting = {
  baseline: number | undefined;
  held: boolean;
  lastJoined: number | undefined;
  shownGone: boolean;
};

export const UNSEEN: WriteSighting = {
  baseline: undefined,
  held: false,
  lastJoined: undefined,
  shownGone: false,
};

/** Since when `userId` is in `channel`: when they joined, or, with no
 * record of them in it, its last update. A rejoin sets the join time again
 * (`add_participant`'s `joined_at = now()`); a message does not. */
function memberSince(channel: DirectoryChannel, userId: string): number {
  const participant = channel.participants.find(
    (person) => person.userId === userId && person.leftAt === null
  );
  return instantMicros(participant?.joinedAt ?? channel.updatedAt);
}

/** `sighting` with `source` seen too, for a write or read by `writer`;
 * `gone` when the source lacks the channel and lists every channel the
 * writer joined. A source that showed the writer out of the channel after
 * the read was sent was past every membership the read could have ended,
 * so every membership it shows after is newer: the first one it shows is
 * then no baseline, and a leave's read landing after a rejoin does not take
 * the rejoin for the membership it ended. Had the write landed first, that
 * absence would have made it past for good. */
export function sightWrite(
  writer: { account: QueryAccount },
  sighting: WriteSighting,
  source: DirectoryChannel | undefined,
  gone = false
): WriteSighting {
  if (!source)
    return gone && !sighting.held && !sighting.shownGone
      ? { ...sighting, shownGone: true }
      : sighting;
  const since = memberSince(source, writer.account.userId);
  const first = sighting.shownGone ? Number.NEGATIVE_INFINITY : since;
  const baseline = sighting.held ? sighting.baseline : first;
  const lastJoined = source.isParticipant ? since : sighting.lastJoined;
  if (
    sighting.held &&
    baseline === sighting.baseline &&
    lastJoined === sighting.lastJoined
  )
    return sighting;
  return { ...sighting, baseline, held: true, lastJoined };
}

/** Whether `source` has yet to show the write, given what the directory saw
 * of the channel since its read was sent (`sighting`, with `source` already
 * in it). The source is behind while it lacks a channel it has not shown
 * since, or shows the channel otherwise than the primary did and not
 * updated after. A channel the source showed and then lost was removed
 * after the read. Whether the writer is in it is judged by their join:
 * removing someone leaves a channel's update time as it was. The source is
 * past a write that has them in once it showed them in since that join and
 * no longer does (they were removed after), and past one that has them out
 * once it shows them joined since it first showed the channel (they joined
 * again after), which is also how a channel they can no longer read stays
 * behind only while it lists them in it as it first did. */
export function sourceBehindWrite(
  write: OwnChannelWrite,
  source: DirectoryChannel | undefined,
  sighting: WriteSighting
): boolean {
  const { channel } = write;
  const { userId } = write.account;
  const rejoinedSince = (shown: DirectoryChannel) =>
    sighting.baseline !== undefined &&
    memberSince(shown, userId) > sighting.baseline;
  if (!channel) return source?.isParticipant === true && !rejoinedSince(source);
  if (!source) return !sighting.held;
  if (instantMicros(source.updatedAt) > instantMicros(channel.updatedAt))
    return false;
  if (channel.isParticipant && !source.isParticipant)
    return !(
      sighting.lastJoined !== undefined &&
      memberSince(channel, userId) <= sighting.lastJoined
    );
  if (!channel.isParticipant && source.isParticipant)
    return !rejoinedSince(source);
  return writtenFields(source) !== writtenFields(channel);
}

/** The channels of `records` with each write in `pending` laid over its own:
 * the primary's record, or none for a channel the viewer can no longer read.
 * `incompleteIds` is `incomplete` less the overlaid channels: the primary's
 * record has every field, so no read waits on it. */
export function overlayOwnWrites(
  records: Readonly<Record<string, DirectoryChannel>>,
  incomplete: Readonly<Record<string, true>>,
  pending: readonly (readonly [string, OwnChannelWrite])[]
): {
  records: Record<string, DirectoryChannel>;
  incompleteIds: string[];
} {
  const overlaid: Record<string, DirectoryChannel> = { ...records };
  for (const [id, { channel }] of pending) {
    if (channel) overlaid[id] = channel;
    else delete overlaid[id];
  }
  const written = new Set(pending.map(([id]) => id));
  return {
    records: overlaid,
    incompleteIds: Object.keys(incomplete).filter((id) => !written.has(id)),
  };
}

const sightingKey = (sequence: number, channelId: string) =>
  `${sequence}:${channelId}`;

/** What a source showed: its records, and whether it shows the writer out
 * of a channel it lacks (a source still loading, or one holding the
 * channel in part, does not). */
type Shown = {
  records: Readonly<Record<string, DirectoryChannel>>;
  absent: (channelId: string) => boolean;
};

const NOWHERE = () => false;

const sightIn = (
  writer: { account: QueryAccount },
  sighting: WriteSighting,
  { records, absent }: Shown,
  channelId: string
) => {
  const source = records[channelId];
  return sightWrite(writer, sighting, source, !source && absent(channelId));
};

/**
 * One directory's view of the held writes: which of them its source is
 * behind. It remembers what its source showed of each channel from the
 * moment a read of it was sent, and a write its source caught up with is
 * past for good and let go from the store, so no later absence or update
 * of the channel reads as lag.
 */
export function createOwnWriteTracker(
  own: OwnChannelWrites,
  account: QueryAccount
) {
  const sightings = new Map<string, WriteSighting>();
  const past = new WeakSet<OwnChannelWrite>();
  // What the source showed last: a read sent since starts from it.
  let lastShown: Shown | undefined;
  const mine = ({ account: writer }: { account: QueryAccount }) =>
    writer.userId === account.userId && writer.session === account.session;
  const sightingOf = (
    writer: { account: QueryAccount },
    key: string,
    channelId: string,
    shown: Shown
  ) => {
    const seen =
      sightings.get(key) ??
      (lastShown ? sightIn(writer, UNSEEN, lastShown, channelId) : UNSEEN);
    return sightIn(writer, seen, shown, channelId);
  };
  const pendingIn = (
    shown: Shown,
    writes: Readonly<Record<string, OwnChannelWrite>>,
    observe: boolean
  ) => {
    const { records } = shown;
    const watched = new Set<string>();
    if (observe)
      for (const read of own.inFlight()) {
        if (!mine(read)) continue;
        for (const id of read.channelIds) {
          const key = sightingKey(read.sequence, id);
          watched.add(key);
          sightings.set(key, sightingOf(read, key, id, shown));
        }
      }
    const pending: [string, OwnChannelWrite][] = [];
    const caughtUp: [string, OwnChannelWrite][] = [];
    for (const [id, write] of Object.entries(writes)) {
      if (!mine(write) || past.has(write)) continue;
      const key = sightingKey(write.sequence, id);
      const source = records[id];
      const sighting = sightingOf(write, key, id, shown);
      if (sourceBehindWrite(write, source, sighting)) {
        if (observe) {
          watched.add(key);
          sightings.set(key, sighting);
        }
        pending.push([id, write]);
      } else if (observe) {
        past.add(write);
        caughtUp.push([id, write]);
      }
    }
    // Not from inside the computation reading the writes, and in one
    // change: a release per channel would republish every directory once
    // for each of a bulk deletion's channels.
    if (caughtUp.length > 0) queueMicrotask(() => own.release(caughtUp));
    if (observe) {
      for (const key of sightings.keys())
        if (!watched.has(key)) sightings.delete(key);
      lastShown = shown;
    }
    return pending;
  };
  return {
    /** The writes the directory's own source, `records`, is behind;
     * `absent` says which channels it lacks as a complete source. Each call
     * is what the directory shows, so it records what it saw. */
    pending: (
      records: Readonly<Record<string, DirectoryChannel>>,
      writes: Readonly<Record<string, OwnChannelWrite>>,
      absent: (channelId: string) => boolean = NOWHERE
    ) => pendingIn({ records, absent }, writes, true),
    /** The writes a one-time read, `records`, is behind, as the directory's
     * source has seen them; it changes nothing the directory remembers. */
    pendingFor: (
      records: Readonly<Record<string, DirectoryChannel>>,
      writes: Readonly<Record<string, OwnChannelWrite>>,
      absent: (channelId: string) => boolean = NOWHERE
    ) => pendingIn({ records, absent }, writes, false),
  };
}

const byKey = <T>(items: readonly T[], key: (item: T) => string) =>
  [...items].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === y) return 0;
    return x < y ? -1 : 1;
  });

function message(value: DirectoryChannel['latestMessage']) {
  return value && { ...value, mentions: [...value.mentions].sort() };
}

/** What a write can change in a channel, comparable as a string. The view,
 * interaction time and frecency score are the viewer's own and move on
 * their own; lists compare as sets, since two reads may order them
 * differently. */
function writtenFields(channel: DirectoryChannel): string {
  const {
    viewedAt: _viewedAt,
    interactedAt: _interactedAt,
    frecencyScore: _frecencyScore,
    updatedAt,
    participants,
    botParticipants,
    latestMessage,
    latestNonThreadMessage,
    ...rest
  } = channel;
  return JSON.stringify({
    ...rest,
    updatedAt: instantMicros(updatedAt),
    participants: byKey(participants, ({ userId }) => userId),
    botParticipants: byKey(botParticipants, ({ botId }) => botId),
    latestMessage: message(latestMessage),
    latestNonThreadMessage: message(latestNonThreadMessage),
  });
}
