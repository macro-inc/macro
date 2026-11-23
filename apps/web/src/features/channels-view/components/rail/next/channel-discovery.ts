import type { ChannelEntity } from '@entity';

/** Preserve name relevance within each group, but put discoverable channels first. */
export function orderSectionSearchResults(channels: readonly ChannelEntity[]) {
  return [
    ...channels.filter((channel) => channel.isParticipant === false),
    ...channels.filter((channel) => channel.isParticipant !== false),
  ];
}
