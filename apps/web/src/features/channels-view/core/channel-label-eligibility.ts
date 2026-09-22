import type { ChannelEntity } from '@entity';

/** Only team channels participate in manual or smart labels. */
export function canLabelChannel(
  channel: Pick<ChannelEntity, 'channelType'> | undefined
): boolean {
  return channel?.channelType === 'team';
}

/** Trust server memberships for unloaded channels; exclude known non-team channels. */
export function filterChannelLabelMembers(
  channelIds: readonly string[],
  channelsById: ReadonlyMap<string, Pick<ChannelEntity, 'channelType'>>
): string[] {
  return channelIds.filter((id) => {
    const channel = channelsById.get(id);
    return channel === undefined || canLabelChannel(channel);
  });
}
