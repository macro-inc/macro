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

type ChannelActivityTarget = {
  channelId: string;
  label: 'New activity' | 'Active call' | 'Incoming call';
  callId?: string;
};

type ChannelCallActivity = {
  callId: string;
  channelId: string;
  status: 'active' | 'incoming';
};

export function useChannelRailActivity(
  channels: Accessor<readonly ChannelEntity[]>,
  calls: Accessor<readonly ChannelCallActivity[]>
) {
  const notificationSource = useGlobalNotificationSource();
  const [activityTargets, setActivityTargets] = createSignal<
    Partial<Record<ChannelsGroup, ChannelActivityTarget>>
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

  const recordActivity = (
    channel: ChannelEntity,
    label: ChannelActivityTarget['label'] = 'New activity',
    callId?: string
  ) => {
    const group = channelGroup(channel);
    setActivityTargets((current) => ({
      ...current,
      [group]: {
        channelId: channel.id,
        label,
        ...(callId ? { callId } : {}),
      },
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

  let activeCallStatuses = new Map<string, ChannelCallActivity['status']>();
  createEffect(() => {
    const nextActiveCallStatuses = new Map<
      string,
      ChannelCallActivity['status']
    >();
    const recordedGroups = new Set<ChannelsGroup>();

    for (const call of calls()) {
      const channel = channelsById().get(call.channelId);
      if (!channel) continue;

      nextActiveCallStatuses.set(call.callId, call.status);
      const previousStatus = activeCallStatuses.get(call.callId);
      if (
        previousStatus !== undefined &&
        !(previousStatus === 'active' && call.status === 'incoming')
      ) {
        continue;
      }

      const group = channelGroup(channel);
      if (recordedGroups.has(group)) continue;

      recordActivity(
        channel,
        call.status === 'incoming' ? 'Incoming call' : 'Active call',
        call.callId
      );
      recordedGroups.add(group);
    }

    setActivityTargets((current) => {
      let next = current;

      for (const group of ['channels', 'direct_messages'] as const) {
        const target = current[group];
        if (!target?.callId) continue;

        const status = nextActiveCallStatuses.get(target.callId);
        if (!status) {
          next = { ...next, [group]: undefined };
        } else if (status === 'active' && target.label === 'Incoming call') {
          next = {
            ...next,
            [group]: { ...target, label: 'Active call' },
          };
        }
      }

      return next;
    });
    activeCallStatuses = nextActiveCallStatuses;
  });

  const target = (group: ChannelsGroup): ChannelActivityTarget | undefined => {
    const recordedTarget = activityTargets()[group];
    if (recordedTarget) return recordedTarget;

    const notificationChannelId =
      notificationActivity().latestChannelIds[group];
    return notificationChannelId
      ? { channelId: notificationChannelId, label: 'New activity' }
      : undefined;
  };

  const targetChannelId = (group: ChannelsGroup) => target(group)?.channelId;

  const clearTarget = (group: ChannelsGroup, channelId: string) => {
    if (targetChannelId(group) !== channelId) return;

    setActivityTargets((current) =>
      current[group]?.channelId === channelId
        ? { ...current, [group]: undefined }
        : current
    );
  };

  return {
    clearTarget,
    targetChannelId,
    targetLabel: (group: ChannelsGroup) => target(group)?.label,
    unreadChannelIds: () => notificationActivity().unreadChannelIds,
    unreadCount: (group: ChannelsGroup) =>
      notificationActivity().unreadCounts[group],
  };
}
