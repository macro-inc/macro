import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { compareDateDesc, type DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ChannelsGroup } from '../../../types';
import { channelGroup } from '../../../utils';
import { CHANNEL_GROUPS } from '../model';

type ChannelActivityTarget = {
  channelId: string;
  source:
    | { type: 'message' }
    | {
        type: 'call';
        callId: string;
      };
};

type ChannelCallActivity = {
  callId: string;
  channelId: string;
  status: 'active' | 'incoming';
};

export function useChannelRailActivity(
  channels: Accessor<ChannelEntity[]>,
  calls: Accessor<ChannelCallActivity[]>
) {
  const notificationSource = useGlobalNotificationSource();
  const [activityTargets, setActivityTargets] = createStore<
    Partial<Record<ChannelsGroup, ChannelActivityTarget>>
  >({});

  const channelsById = createMemo(
    () => new Map(channels().map((channel) => [channel.id, channel]))
  );

  const callStatuses = createMemo(
    () => new Map(calls().map((call) => [call.callId, call.status]))
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
    source: ChannelActivityTarget['source'] = { type: 'message' }
  ) => {
    const group = channelGroup(channel);
    setActivityTargets(group, {
      channelId: channel.id,
      source,
    });
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
    const nextActiveCallStatuses = callStatuses();
    const recordedGroups = new Set<ChannelsGroup>();

    for (const call of calls()) {
      const channel = channelsById().get(call.channelId);
      if (!channel) continue;

      const previousStatus = activeCallStatuses.get(call.callId);
      if (
        previousStatus !== undefined &&
        !(previousStatus === 'active' && call.status === 'incoming')
      ) {
        continue;
      }

      const group = channelGroup(channel);
      if (recordedGroups.has(group)) continue;

      recordActivity(channel, { type: 'call', callId: call.callId });
      recordedGroups.add(group);
    }

    for (const group of CHANNEL_GROUPS) {
      const target = activityTargets[group];
      if (target?.source.type !== 'call') continue;

      const status = nextActiveCallStatuses.get(target.source.callId);
      if (!status) setActivityTargets(group, undefined);
    }

    activeCallStatuses = nextActiveCallStatuses;
  });

  const target = (group: ChannelsGroup): ChannelActivityTarget | undefined => {
    const recordedTarget = activityTargets[group];
    if (recordedTarget) return recordedTarget;

    const notificationChannelId =
      notificationActivity().latestChannelIds[group];
    return notificationChannelId
      ? {
          channelId: notificationChannelId,
          source: { type: 'message' },
        }
      : undefined;
  };

  const targetChannelId = (group: ChannelsGroup) => target(group)?.channelId;

  const targetLabel = (group: ChannelsGroup) => {
    const source = target(group)?.source;
    if (!source) return;
    if (source.type === 'message') return 'New activity';

    return callStatuses().get(source.callId) === 'incoming'
      ? 'Incoming call'
      : 'Active call';
  };

  const clearTarget = (group: ChannelsGroup, channelId: string) => {
    if (targetChannelId(group) !== channelId) return;

    if (activityTargets[group]?.channelId === channelId) {
      setActivityTargets(group, undefined);
    }
  };

  return {
    clearTarget,
    targetChannelId,
    targetLabel,
    unreadChannelIds: () => notificationActivity().unreadChannelIds,
    unreadCount: (group: ChannelsGroup) =>
      notificationActivity().unreadCounts[group],
  };
}
