import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { compareDateDesc, type DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { ChannelsGroup } from '../../types';

const channelGroup = (channel: ChannelEntity): ChannelsGroup =>
  channel.channelType === 'direct_message' ? 'direct_messages' : 'channels';

export function useChannelRailActivity(
  channels: Accessor<readonly ChannelEntity[]>
) {
  const notificationSource = useGlobalNotificationSource();
  const [activityChannelIds, setActivityChannelIds] = createSignal<
    Partial<Record<ChannelsGroup, string>>
  >({});
  const channelsById = createMemo(
    () => new Map(channels().map((channel) => [channel.id, channel]))
  );

  const notificationActivity = createMemo(() => {
    const unreadChannelIds = new Set<string>();
    const unreadCounts: Record<ChannelsGroup, number> = {
      channels: 0,
      direct_messages: 0,
    };
    const latestChannelIds: Partial<Record<ChannelsGroup, string>> = {};
    const notifications = [...notificationSource.notifications()].sort((a, b) =>
      compareDateDesc(a.created_at, b.created_at)
    );

    for (const notification of notifications) {
      if (
        notification.entity_type !== 'channel' ||
        notificationIsRead(notification)
      ) {
        continue;
      }

      const isFirstUnreadForChannel = !unreadChannelIds.has(
        notification.entity_id
      );
      unreadChannelIds.add(notification.entity_id);

      const channel = channelsById().get(notification.entity_id);
      if (!channel) continue;

      const group = channelGroup(channel);
      if (isFirstUnreadForChannel) unreadCounts[group] += 1;
      latestChannelIds[group] ??= channel.id;
    }

    return { latestChannelIds, unreadChannelIds, unreadCounts };
  });

  const recordActivity = (channel: ChannelEntity) => {
    const group = channelGroup(channel);
    setActivityChannelIds((current) => ({
      ...current,
      [group]: channel.id,
    }));
  };

  onCleanup(
    notificationSource.subscribe((notification) => {
      if (
        notification.entity_type !== 'channel' ||
        notificationIsRead(notification)
      ) {
        return;
      }

      const channel = channelsById().get(notification.entity_id);
      if (channel) recordActivity(channel);
    })
  );

  let latestMessageTimes = new Map<string, DateValue | undefined>();
  createEffect(() => {
    const nextMessageTimes = new Map<string, DateValue | undefined>();

    for (const channel of channels()) {
      const nextMessageTime = channel.latestRootMessage?.createdAt;
      nextMessageTimes.set(channel.id, nextMessageTime);

      if (
        latestMessageTimes.has(channel.id) &&
        nextMessageTime !== undefined &&
        nextMessageTime !== latestMessageTimes.get(channel.id)
      ) {
        recordActivity(channel);
      }
    }

    latestMessageTimes = nextMessageTimes;
  });

  const targetChannelId = (group: ChannelsGroup) =>
    activityChannelIds()[group] ??
    notificationActivity().latestChannelIds[group];

  const clearTarget = (group: ChannelsGroup, channelId: string) => {
    if (targetChannelId(group) !== channelId) return;

    setActivityChannelIds((current) =>
      current[group] === channelId
        ? { ...current, [group]: undefined }
        : current
    );
  };

  return {
    clearTarget,
    targetChannelId,
    unreadChannelIds: () => notificationActivity().unreadChannelIds,
    unreadCount: (group: ChannelsGroup) =>
      notificationActivity().unreadCounts[group],
  };
}
