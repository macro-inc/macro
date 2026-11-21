/**
 * Channels the viewer just changed, as the primary database showed them
 * right after the write. Both directories trail a write: the in-memory pages
 * read a replica that lags it, and the cache waits for the server's soup
 * update. A directory lays each write over what it read until its own source
 * shows the same channel or a later update of it, or the hold ends.
 */
import type { QueryClient } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { type DirectoryChannel, instantMicros } from './directory-core';

/** How long a write stays over a source that has not caught up with it. */
export const OWN_WRITE_HOLD_MS = 60_000;

export type OwnChannelWrite = {
  /** The channel as the primary read it after the write; null once the
   * viewer can no longer read it (they deleted it, or lost access). */
  channel: DirectoryChannel | null;
  /** The viewer whose write it was: another viewer's directory ignores it. */
  userId: string;
};

export type OwnChannelWrites = {
  /** The writes held now, by channel id. */
  writes: Accessor<Readonly<Record<string, OwnChannelWrite>>>;
  /** Holds `write` for `OWN_WRITE_HOLD_MS`, in place of the channel's last. */
  record: (channelId: string, write: OwnChannelWrite) => void;
};

const OWN_WRITES = new WeakMap<QueryClient, OwnChannelWrites>();

/** The viewer's own channel writes, held for `client`'s directories. */
export function ownChannelWrites(client: QueryClient): OwnChannelWrites {
  const existing = OWN_WRITES.get(client);
  if (existing) return existing;
  const [writes, setWrites] = createSignal<
    Readonly<Record<string, OwnChannelWrite>>
  >({});
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  const expire = (channelId: string, write: OwnChannelWrite) => {
    // A later write of the channel replaced this one and keeps its own hold.
    if (writes()[channelId] !== write) return;
    expiries.delete(channelId);
    setWrites((previous) => {
      const { [channelId]: _expired, ...rest } = previous;
      return rest;
    });
  };
  const created: OwnChannelWrites = {
    writes,
    record(channelId, write) {
      clearTimeout(expiries.get(channelId));
      expiries.set(
        channelId,
        setTimeout(() => expire(channelId, write), OWN_WRITE_HOLD_MS)
      );
      setWrites((previous) => ({ ...previous, [channelId]: write }));
    },
  };
  OWN_WRITES.set(client, created);
  return created;
}

/** Whether `source` has yet to show the write: it lacks the channel the
 * primary read, shows it otherwise, or still lists a channel the viewer can
 * no longer read. A source that shows a later update of the channel is past
 * the write. */
export function sourceBehindWrite(
  write: OwnChannelWrite,
  source: DirectoryChannel | undefined
): boolean {
  const { channel } = write;
  if (!channel) return source?.isParticipant === true;
  if (!source) return true;
  if (instantMicros(source.updatedAt) > instantMicros(channel.updatedAt))
    return false;
  return writtenFields(source) !== writtenFields(channel);
}

/** The records a directory of `userId` shows: `records` with each write
 * its source is behind laid over its own. Undefined when the source shows
 * every write. */
export function overlayOwnWrites(
  records: Readonly<Record<string, DirectoryChannel>>,
  incomplete: Readonly<Record<string, true>>,
  writes: Readonly<Record<string, OwnChannelWrite>>,
  userId: string
):
  | {
      channels: DirectoryChannel[];
      /** `incomplete` less the overlaid channels: the primary's record has
       * every field, so no read waits on it. */
      incompleteIds: string[];
    }
  | undefined {
  const pending = Object.entries(writes).filter(
    ([id, write]) =>
      write.userId === userId && sourceBehindWrite(write, records[id])
  );
  if (pending.length === 0) return undefined;
  const overlaid: Record<string, DirectoryChannel> = { ...records };
  for (const [id, { channel }] of pending) {
    if (channel) overlaid[id] = channel;
    else delete overlaid[id];
  }
  const written = new Set(pending.map(([id]) => id));
  return {
    channels: Object.values(overlaid),
    incompleteIds: Object.keys(incomplete).filter((id) => !written.has(id)),
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
