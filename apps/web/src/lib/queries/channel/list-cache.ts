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
 * Returns the same array when nothing changed. Treats a missing list as
 * empty so a just-created channel can land before the first fetch returns.
 */
export function mergeListChannel(
  channels: ApiChannelWithLatest[] | undefined,
  update: ListChannelUpsert
): ApiChannelWithLatest[] {
  const list = channels ?? [];

  const index = list.findIndex((channel) => channel.id === update.id);
  if (index === -1) {
    return [stubListChannel(update), ...list];
  }

  const existing = list[index];
  if (!existing) return list;

  const next = applyListChannelUpdate(existing, update);
  if (next === existing) return list;

  const copy = list.slice();
  copy[index] = next;
  return copy;
}

/** Merge one update onto an existing list row, or build a stub. */
export function overlayListChannel(
  existing: ApiChannelWithLatest | undefined,
  update: ListChannelUpsert
): ApiChannelWithLatest {
  return existing
    ? applyListChannelUpdate(existing, update)
    : stubListChannel(update);
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
