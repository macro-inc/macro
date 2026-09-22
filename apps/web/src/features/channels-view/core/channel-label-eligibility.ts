import type { ChannelEntity } from '@entity';

/** All known channels except direct messages participate in manual or smart labels. */
export function canLabelChannel(
  channel: Pick<ChannelEntity, 'channelType'> | undefined
): boolean {
  return channel !== undefined && channel.channelType !== 'direct_message';
}

/** Trust server memberships for unloaded channels; exclude known direct messages. */
export function filterChannelLabelMembers(
  channelIds: readonly string[],
  channelsById: ReadonlyMap<string, Pick<ChannelEntity, 'channelType'>>
): string[] {
  return channelIds.filter((id) => {
    const channel = channelsById.get(id);
    return channel === undefined || canLabelChannel(channel);
  });
}
