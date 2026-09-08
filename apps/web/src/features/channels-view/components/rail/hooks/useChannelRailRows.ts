import { compareDateDesc } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelsGroup, ChannelsTab } from '../../../types';
import { type ChannelRailRow, conversationRow, sectionRow } from '../model';

export function useChannelRailRows(options: {
  channels: Accessor<ChannelEntity[]>;
  tab: Accessor<ChannelsTab>;
  isGroupExpanded: (group: ChannelsGroup) => boolean;
}) {
  const teamChannels = createMemo(() =>
    options
      .channels()
      .filter((channel) => channel.channelType !== 'direct_message')
  );

  const directMessages = createMemo(() =>
    options
      .channels()
      .filter((channel) => channel.channelType === 'direct_message')
  );

  const recentConversations = createMemo(() =>
    options
      .channels()
      .filter((channel) => channel.latestRootMessage)
      .sort((a, b) =>
        compareDateDesc(
          a.latestRootMessage?.createdAt,
          b.latestRootMessage?.createdAt
        )
      )
  );

  const visibleRows = createMemo<ChannelRailRow[]>(() => {
    if (options.tab() === 'recents') {
      return recentConversations().map((channel) => conversationRow(channel));
    }

    const rows: ChannelRailRow[] = [sectionRow('channels')];
    if (options.isGroupExpanded('channels')) {
      rows.push(
        ...teamChannels().map((channel) => conversationRow(channel, 'channels'))
      );
    }

    rows.push(sectionRow('direct_messages'));
    if (options.isGroupExpanded('direct_messages')) {
      rows.push(
        ...directMessages().map((channel) =>
          conversationRow(channel, 'direct_messages')
        )
      );
    }

    return rows;
  });

  return {
    directMessages,
    recentConversations,
    teamChannels,
    visibleRows,
  };
}
