import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';

/** Personal sections accept named conversations; shared sections stay team-only. */
export function canLabelChannel(
  channel: Pick<ChannelEntity, 'channelType'> | undefined,
  label?: Pick<ChannelLabel, 'teamId'>
): boolean {
  if (label?.teamId) return channel?.channelType === 'team';
  return (
    channel?.channelType === 'team' ||
    channel?.channelType === 'public' ||
    channel?.channelType === 'private'
  );
}

/** Preserve authorized server memberships until the channel metadata arrives. */
export function filterChannelLabelMembers(
  channelIds: readonly string[],
  channelsById: ReadonlyMap<string, Pick<ChannelEntity, 'channelType'>>,
  label?: Pick<ChannelLabel, 'teamId'>
): string[] {
  return channelIds.filter((id) => {
    const channel = channelsById.get(id);
    return channel === undefined || canLabelChannel(channel, label);
  });
}
