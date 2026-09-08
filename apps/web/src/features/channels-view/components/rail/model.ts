import type { ChannelEntity } from '@entity';
import type { ChannelsGroup } from '../../types';

export const CHANNEL_GROUPS: ChannelsGroup[] = ['channels', 'direct_messages'];

export type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsGroup}`;
      group: ChannelsGroup;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      channel: ChannelEntity;
    };

export const sectionRow = (group: ChannelsGroup): ChannelRailRow => ({
  kind: 'section',
  id: `section:${group}`,
  group,
});

export const conversationRow = (
  channel: ChannelEntity,
  group?: ChannelsGroup
): ChannelRailRow => ({
  kind: 'conversation',
  id: `channel:${channel.id}`,
  group,
  channel,
});

export const rowKeyForChannel = (channelId: string) => `channel:${channelId}`;

export const rowKeyForSection = (group: ChannelsGroup) => `section:${group}`;
