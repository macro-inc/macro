/**
 * Channels the viewer just changed, as the primary database showed them
 * right after the write. Both directories trail a write: the in-memory pages
 * read a replica that lags it, and the cache waits for the server's soup
 * update. A directory lays each write over what it read until its own source
 * shows the same channel or a later update of it, or the hold ends. Once a
 * source has, the write is let go for every directory: what the channel does
 * next (a deletion, a rejoin, someone else's rename) is the source's to show,
 * never a lag the write covers.
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

export type OwnChannelWrites = {
  /** The writes held now, by channel id. */
  writes: Accessor<Readonly<Record<string, OwnChannelWrite>>>;
  /** The order of a read of the primary sent now. */
  nextSequence: () => number;
  /** Holds each write for `OWN_WRITE_HOLD_MS` in place of its channel's
   * last, all at once. A write whose read was sent before one the store
   * already took for its channel, or before the last `clear`, is dropped. */
  record: (writes: Readonly<Record<string, OwnChannelWrite>>) => void;
  /** Lets `write` go before its hold ends, unless a later write of the
   * channel replaced it. */
  release: (channelId: string, write: OwnChannelWrite) => void;
  /** Lets every write go, and drops the reads still in flight: the storage
   * the directories read was replaced. */
  clear: () => void;
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
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  // The latest read taken for each channel, kept after its write goes, so a
  // read sent before it can never land later.
  const latest = new Map<string, number>();
  let sequence = 0;
  let clearedAt = 0;
  const release = (channelId: string, write: OwnChannelWrite) => {
    if (untrack(writes)[channelId] !== write) return;
    clearTimeout(expiries.get(channelId));
    expiries.delete(channelId);
    setWrites((previous) => {
      const { [channelId]: _released, ...rest } = previous;
      return rest;
    });
  };
  const created: OwnChannelWrites = {
    writes,
    nextSequence: () => {
      sequence += 1;
      return sequence;
    },
    record(next) {
      const taken: Record<string, OwnChannelWrite> = {};
      for (const [channelId, write] of Object.entries(next)) {
        if (write.sequence <= clearedAt) continue;
        if ((latest.get(channelId) ?? 0) > write.sequence) continue;
        latest.set(channelId, write.sequence);
        taken[channelId] = write;
        clearTimeout(expiries.get(channelId));
        expiries.set(
          channelId,
          setTimeout(() => release(channelId, write), OWN_WRITE_HOLD_MS)
        );
      }
      if (Object.keys(taken).length === 0) return;
      setWrites((previous) => ({ ...previous, ...taken }));
    },
    release,
    clear() {
      clearedAt = sequence;
      for (const timer of expiries.values()) clearTimeout(timer);
      expiries.clear();
      if (Object.keys(untrack(writes)).length > 0) setWrites({});
    },
  };
  OWN_WRITES.set(client, created);
  return created;
}

/** What one directory has seen of a channel since a write of it: whether
 * its source showed a record of it, and since when the writer was in the
 * first one it showed. */
export type WriteSighting = {
  baseline: number | undefined;
  held: boolean;
};

export const UNSEEN: WriteSighting = { baseline: undefined, held: false };

/** Since when `userId` is in `channel`: when they joined, or, with no
 * record of them in it, its last update. A rejoin sets the join time again
 * (`add_participant`'s `joined_at = now()`); a message does not. */
function memberSince(channel: DirectoryChannel, userId: string): number {
  const participant = channel.participants.find(
    (person) => person.userId === userId && person.leftAt === null
  );
  return instantMicros(participant?.joinedAt ?? channel.updatedAt);
}

/** `sighting` with `source` seen too. */
export function sightWrite(
  write: OwnChannelWrite,
  sighting: WriteSighting,
  source: DirectoryChannel | undefined
): WriteSighting {
  if (!source || sighting.held) return sighting;
  return {
    baseline: memberSince(source, write.account.userId),
    held: true,
  };
}

/** Whether `source` has yet to show the write, given what the directory saw
 * of the channel since (`sighting`, with `source` already in it). The source
 * is behind while it lacks a channel it has not shown since the write, or
 * shows the channel otherwise than the primary did and not updated after;
 * or, for a channel the viewer can no longer read, while it lists them in
 * it as it did when it first showed the channel. A channel the source
 * showed and then lost was removed after the write, and the viewer joining
 * it again is past it. */
export function sourceBehindWrite(
  write: OwnChannelWrite,
  source: DirectoryChannel | undefined,
  sighting: WriteSighting
): boolean {
  const { channel } = write;
  if (!channel) {
    if (source?.isParticipant !== true) return false;
    return (
      sighting.baseline === undefined ||
      memberSince(source, write.account.userId) <= sighting.baseline
    );
  }
  if (!source) return !sighting.held;
  if (instantMicros(source.updatedAt) > instantMicros(channel.updatedAt))
    return false;
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

/**
 * One directory's view of the held writes: which of them its source is
 * behind. It remembers what its source showed of each written channel, and
 * a write its source caught up with is past for good and let go from the
 * store, so no later absence or update of the channel reads as lag.
 */
export function createOwnWriteTracker(
  own: OwnChannelWrites,
  account: QueryAccount
) {
  const sightings = new WeakMap<OwnChannelWrite, WriteSighting>();
  const past = new WeakSet<OwnChannelWrite>();
  const mine = (write: OwnChannelWrite) =>
    write.account.userId === account.userId &&
    write.account.session === account.session;
  const pendingIn = (
    records: Readonly<Record<string, DirectoryChannel>>,
    writes: Readonly<Record<string, OwnChannelWrite>>,
    observe: boolean
  ) => {
    const pending: [string, OwnChannelWrite][] = [];
    for (const [id, write] of Object.entries(writes)) {
      if (!mine(write) || past.has(write)) continue;
      const source = records[id];
      const sighting = sightWrite(
        write,
        sightings.get(write) ?? UNSEEN,
        source
      );
      if (sourceBehindWrite(write, source, sighting)) {
        if (observe) sightings.set(write, sighting);
        pending.push([id, write]);
      } else if (observe) {
        past.add(write);
        // Not from inside the computation reading the writes.
        queueMicrotask(() => own.release(id, write));
      }
    }
    return pending;
  };
  return {
    /** The writes the directory's own source, `records`, is behind. Each
     * call is what the directory shows, so it records what it saw. */
    pending: (
      records: Readonly<Record<string, DirectoryChannel>>,
      writes: Readonly<Record<string, OwnChannelWrite>>
    ) => pendingIn(records, writes, true),
    /** The writes a one-time read, `records`, is behind, as the directory's
     * source has seen them; it changes nothing the directory remembers. */
    pendingFor: (
      records: Readonly<Record<string, DirectoryChannel>>,
      writes: Readonly<Record<string, OwnChannelWrite>>
    ) => pendingIn(records, writes, false),
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
