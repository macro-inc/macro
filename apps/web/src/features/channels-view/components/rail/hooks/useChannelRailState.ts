import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isMutedItem } from '@entity/utils/notification';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelsGroup } from '../../../types';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';

export function useChannelRailItemState(channelId: Accessor<string>) {
  const rail = useChannelsRail();
  const notificationSource = useGlobalNotificationSource();

  return createMemo(() => {
    const id = channelId();
    const rowId = rowKeyForChannel(id);

    return {
      domId: domIdForRow(rail.railId, rowId),
      selected: rail.selectedChannelId() === id,
      focused: rail.list.focus.key() === rowId,
      muted: isMutedItem(notificationSource.mutedEntities(), {
        item_id: id,
        item_type: 'channel',
      }),
      unread: rail.channelActivity.unreadChannelIds().has(id),
      callStatus: rail.channelActivity.callStatuses().get(id),
      incomingCallId: rail.channelActivity.incomingCallIds().get(id),
    };
  });
}

export function useChannelRailSectionState(group: Accessor<ChannelsGroup>) {
  const rail = useChannelsRail();
  const state = createMemo(() => {
    const section = group();
    const rowId = rowKeyForSection(section);
    const targetChannelId = rail.channelActivity.targetChannelId(section);

    return {
      items:
        section === 'channels' ? rail.teamChannels() : rail.directMessages(),
      open: rail.isGroupOpen(section),
      fillAvailable:
        section === 'direct_messages' && !rail.isGroupOpen('channels'),
      focused: rail.list.focus.key() === rowId,
      containsFocus: rail.list.focus.item()?.group === section,
      domId: domIdForRow(rail.railId, rowId),
      unreadCount: rail.channelActivity.unreadCount(section),
      targetId:
        targetChannelId === undefined
          ? undefined
          : domIdForRow(rail.railId, rowKeyForChannel(targetChannelId)),
      label: rail.channelActivity.targetLabel(section),
    };
  });

  const clearVisibleActivity = (visibleTargetId: string) => {
    const section = group();
    const targetChannelId = rail.channelActivity.targetChannelId(section);
    if (
      targetChannelId === undefined ||
      domIdForRow(rail.railId, rowKeyForChannel(targetChannelId)) !==
        visibleTargetId
    ) {
      return;
    }

    rail.channelActivity.clearTarget(section, targetChannelId);
  };

  return { state, clearVisibleActivity };
}
