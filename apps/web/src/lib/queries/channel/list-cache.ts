import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';

/** Fields a cache writer can seed into the REST channel list. */
export type ListChannelUpsert = {
  id: string;
  name?: string;
  channel_type?: ApiChannelWithLatest['channel_type'];
};

/**
 * Insert or patch one row in a `GET /comms/channels` list.
 *
 * Returns the same array when nothing changed. Returns `undefined` when the
 * list has never been fetched — callers must not invent a one-item list that
 * a later fetch would replace.
 */
export function mergeListChannel(
  channels: ApiChannelWithLatest[] | undefined,
  update: ListChannelUpsert
): ApiChannelWithLatest[] | undefined {
  if (!channels) return channels;

  const index = channels.findIndex((channel) => channel.id === update.id);
  if (index === -1) {
    return [stubListChannel(update), ...channels];
  }

  const existing = channels[index];
  if (!existing) return channels;

  const next = applyListChannelUpdate(existing, update);
  if (next === existing) return channels;

  const copy = channels.slice();
  copy[index] = next;
  return copy;
}

function applyListChannelUpdate(
  existing: ApiChannelWithLatest,
  update: ListChannelUpsert
): ApiChannelWithLatest {
  const name =
    update.name !== undefined && update.name !== existing.name
      ? update.name
      : existing.name;
  const channel_type =
    update.channel_type !== undefined &&
    update.channel_type !== existing.channel_type
      ? update.channel_type
      : existing.channel_type;

  if (name === existing.name && channel_type === existing.channel_type) {
    return existing;
  }

  return { ...existing, name, channel_type };
}

function stubListChannel(update: ListChannelUpsert): ApiChannelWithLatest {
  const now = new Date().toISOString();
  return {
    id: update.id,
    name: update.name,
    channel_type: update.channel_type ?? 'private',
    owner_id: '',
    created_at: now,
    updated_at: now,
    auto_join_team: false,
    is_participant: true,
    participants: [],
  };
}
