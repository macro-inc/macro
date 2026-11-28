import {
  BOT_PRINCIPAL_PREFIX,
  type DirectoryChannel,
} from '@queries/channel/directory-core';
import type { CachedGraphqlChannel } from '@queries/channel/graphql';

const directoryRows = new WeakMap<DirectoryChannel, CachedGraphqlChannel>();

/**
 * Quick Access's row for a directory channel, read straight from the
 * directory record. Bots join the participants as `bot|<id>`, as the channel
 * list sends them. One record always maps to the same row: directory records
 * are immutable copies, replaced when the channel changes.
 */
export function directoryQuickAccessChannel(
  channel: DirectoryChannel
): CachedGraphqlChannel {
  const cached = directoryRows.get(channel);
  if (cached) return cached;
  const row: CachedGraphqlChannel = {
    id: channel.id,
    name: channel.name ?? '',
    ownerId: channel.ownerId,
    channelType: channel.channelType,
    participantIds: [
      ...channel.participants.map((participant) => participant.userId),
      ...channel.botParticipants.map(
        (participant) => `${BOT_PRINCIPAL_PREFIX}${participant.botId}`
      ),
    ],
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    viewedAt: channel.viewedAt ?? undefined,
    interactedAt: channel.interactedAt ?? undefined,
  };
  directoryRows.set(channel, row);
  return row;
}

/**
 * Whether `row` already shows `channel` as last viewed at `viewedAt`, compared
 * field by field, so an unchanged channel costs no copy or serialization.
 */
export function showsQuickAccessChannel(
  row: CachedGraphqlChannel,
  channel: CachedGraphqlChannel,
  viewedAt: string | undefined
): boolean {
  if (
    row.viewedAt !== viewedAt ||
    row.id !== channel.id ||
    row.name !== channel.name ||
    row.ownerId !== channel.ownerId ||
    row.channelType !== channel.channelType ||
    row.createdAt !== channel.createdAt ||
    row.updatedAt !== channel.updatedAt ||
    row.interactedAt !== channel.interactedAt
  )
    return false;
  if (row.participantIds === channel.participantIds) return true;
  if (row.participantIds.length !== channel.participantIds.length) return false;
  return row.participantIds.every(
    (participant, index) => participant === channel.participantIds[index]
  );
}
