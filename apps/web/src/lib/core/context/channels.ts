import type { DateValue } from '@core/util/date';
import {
  type ChannelDirectory,
  type ChannelLookup,
  createAppChannelDirectory,
  sameChannelLookup,
} from '@queries/channel/directory';
import {
  BOT_PRINCIPAL_PREFIX,
  type DirectoryChannel,
  type DirectoryChannelType,
} from '@queries/channel/directory-core';
import { type Accessor, createMemo } from 'solid-js';
import { createAssertedContextProvider } from './createContext';
import { useUserId } from './user';

export type { ChannelDirectory, ChannelLookup, DirectoryChannel };

type ChannelDirectoryProviderProps = {
  /** A directory to provide instead of the app's, for tests and fixtures. */
  directory?: ChannelDirectory;
};

/**
 * The viewer's channels for the app: one directory, read from the GraphQL
 * cache (or the network without one), shared by every reader under it.
 */
export const [ChannelDirectoryProvider, useChannelDirectory] =
  createAssertedContextProvider(
    'ChannelDirectory',
    (props: ChannelDirectoryProviderProps): ChannelDirectory =>
      props.directory ?? createAppChannelDirectory()
  );

/** One channel the viewer joined: `pending` while a cold directory cannot
 * tell yet, `missing` when it is not one of theirs. */
export function useChannelLookup(
  channelId: string | Accessor<string>
): Accessor<ChannelLookup> {
  const directory = useChannelDirectory();
  const id = typeof channelId === 'string' ? () => channelId : channelId;
  return createMemo(() => directory.lookup(id()), undefined, {
    equals: sameChannelLookup,
  });
}

/** The joined channel a lookup found, undefined while pending or missing. */
export function loadedChannel(
  lookup: ChannelLookup
): DirectoryChannel | undefined {
  return lookup.status === 'loaded' ? lookup.channel : undefined;
}

/** A channel the viewer joined, undefined while pending or missing. */
export function useChannel(
  channelId: string | Accessor<string>
): Accessor<DirectoryChannel | undefined> {
  const lookup = useChannelLookup(channelId);
  return createMemo(() => loadedChannel(lookup()));
}

/**
 * Whether a channel can host a call: unknown while the directory cannot tell,
 * and never in an agent DM. A channel the viewer has not joined is not one of
 * their agent DMs, so it can, as before agent DMs existed.
 */
export function useChannelCanCall(
  channelId: string
): Accessor<boolean | undefined> {
  const lookup = useChannelLookup(channelId);
  return createMemo(() => {
    const result = lookup();
    if (result.status === 'loaded') return !result.channel.agentDm;
    return result.status === 'pending' ? undefined : true;
  });
}

export function useChannelName(channelId: string, fallback?: string) {
  const channel = useChannel(channelId);
  return createMemo(() => channel()?.name ?? fallback);
}

export function useChannelType(
  channelId: string
): Accessor<DirectoryChannelType | undefined> {
  const channel = useChannel(channelId);
  return createMemo(() => channel()?.channelType);
}

/** Every member's id, people first, then bots as `bot|` principals: the
 * members a call or a DM's Work counts, as the REST list sent them. */
export function channelMemberIds(channel: DirectoryChannel): string[] {
  return [
    ...channel.participants.map(({ userId }) => userId),
    ...channel.botParticipants.map(
      ({ botId }) => `${BOT_PRINCIPAL_PREFIX}${botId}`
    ),
  ];
}

/** The person (or `bot|` principal) a DM is with, from the viewer's side. */
export function directMessagePeer(
  channel: DirectoryChannel,
  viewerId: string | undefined
): string | undefined {
  const person = channel.participants.find(({ userId }) => userId !== viewerId);
  if (person) return person.userId;
  const bot = channel.botParticipants[0];
  return bot ? `${BOT_PRINCIPAL_PREFIX}${bot.botId}` : undefined;
}

/**
 * Get a reactive map of userId -> Date for the most recent DM
 * activity with that user. Useful for ranking/sorting users by recency of
 * interaction.
 */
export function useDmActivityByUserId(): Accessor<Map<string, DateValue>> {
  const { channels } = useChannelDirectory();
  const currentUserId = useUserId();

  return createMemo(() => {
    const currentUser = currentUserId();
    if (!currentUser) return new Map();

    const map = new Map<string, DateValue>();
    for (const channel of channels()) {
      if (channel.channelType !== 'direct_message') continue;
      const peer = directMessagePeer(channel, currentUser);
      if (peer) map.set(peer, channel.updatedAt);
    }
    return map;
  });
}
