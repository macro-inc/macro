import type { ChannelEntity } from '@entity';

/** Only team channels participate in manual or smart labels. */
export function canLabelChannel(
  channel: Pick<ChannelEntity, 'channelType'> | undefined
): boolean {
  return channel?.channelType === 'team';
}
