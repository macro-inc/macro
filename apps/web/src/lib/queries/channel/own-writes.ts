/**
 * Channels the viewer just changed, as the primary database showed them
 * right after the write. Both directories trail a write: the in-memory pages
 * read a replica that lags it, and the cache waits for the server's soup
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
export type OwnWriteRead = {
  sequence: number;
  account: QueryAccount;
  channelIds: readonly string[];
};

/** A read of the primary, sent. */
export type SentOwnWriteRead = {
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
  // One hold per read that took writes, however many channels it named.
  const holds = new Set<ReturnType<typeof setTimeout>>();
  // The latest read taken for each channel, kept after its write goes, so a
  // read sent before it can never land later.
  const latest = new Map<string, number>();
  const inFlight = new Map<number, OwnWriteRead>();
  let sequence = 0;
  let clearedAt = 0;
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
      release(taken);
    }, OWN_WRITE_HOLD_MS);
    holds.add(hold);
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
        },
      };
    },
    release,
    clear() {
      clearedAt = sequence;
      inFlight.clear();
      for (const hold of holds) clearTimeout(hold);
      holds.clear();
      if (Object.keys(untrack(writes)).length > 0) setWrites({});
    },
  };
  OWN_WRITES.set(client, created);
  return created;
}

type SettledChannels = Readonly<Record<string, DirectoryChannel | null>>;

/** What one directory has seen of a channel since a read of it was sent:
 * whether its source showed a record of it, since when the writer was in
 * the first one it showed (`baseline`), and since when they were in the
 * last one that listed them in it (`lastJoined`). */
export type WriteSighting = {
  baseline: number | undefined;
  held: boolean;
  lastJoined: number | undefined;
};

export const UNSEEN: WriteSighting = {
  baseline: undefined,
  held: false,
  lastJoined: undefined,
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

/** `sighting` with `source` seen too, for a write or read by `writer`. */
export function sightWrite(
  writer: { account: QueryAccount },
  sighting: WriteSighting,
  source: DirectoryChannel | undefined
): WriteSighting {
  if (!source) return sighting;
  const since = memberSince(source, writer.account.userId);
  const baseline = sighting.held ? sighting.baseline : since;
  const lastJoined = source.isParticipant ? since : sighting.lastJoined;
  if (
    sighting.held &&
    baseline === sighting.baseline &&
    lastJoined === sighting.lastJoined
  )
    return sighting;
  return { baseline, held: true, lastJoined };
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
  let lastShown: Readonly<Record<string, DirectoryChannel>> | undefined;
  const mine = ({ account: writer }: { account: QueryAccount }) =>
    writer.userId === account.userId && writer.session === account.session;
  const sightingOf = (
    writer: { account: QueryAccount },
    key: string,
    channelId: string,
    source: DirectoryChannel | undefined
  ) => {
    const seen =
      sightings.get(key) ??
      (lastShown ? sightWrite(writer, UNSEEN, lastShown[channelId]) : UNSEEN);
    return sightWrite(writer, seen, source);
  };
  const pendingIn = (
    records: Readonly<Record<string, DirectoryChannel>>,
    writes: Readonly<Record<string, OwnChannelWrite>>,
    observe: boolean
  ) => {
    const watched = new Set<string>();
    if (observe)
      for (const read of own.inFlight()) {
        if (!mine(read)) continue;
        for (const id of read.channelIds) {
          const key = sightingKey(read.sequence, id);
          watched.add(key);
          sightings.set(key, sightingOf(read, key, id, records[id]));
        }
      }
    const pending: [string, OwnChannelWrite][] = [];
    const caughtUp: [string, OwnChannelWrite][] = [];
    for (const [id, write] of Object.entries(writes)) {
      if (!mine(write) || past.has(write)) continue;
      const key = sightingKey(write.sequence, id);
      const source = records[id];
      const sighting = sightingOf(write, key, id, source);
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
      lastShown = records;
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
