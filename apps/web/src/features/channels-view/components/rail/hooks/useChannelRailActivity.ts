import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { compareDateDesc, type DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ChannelsGroup } from '../../../types';
import { channelGroup } from '../../../utils';
import type { useChannelCalls } from './useChannelCalls';

const CHANNEL_GROUPS: ChannelsGroup[] = ['channels', 'direct_messages'];

type ChannelActivityTarget = {
  channelId: string;
  source:
    | { type: 'message' }
    | { type: 'notification'; notificationId: string }
    | {
        type: 'call';
        callId: string;
      };
};

export function useChannelRailActivity(
  channels: Accessor<ChannelEntity[]>,
  calls: ReturnType<typeof useChannelCalls>
) {
  const notificationSource = useGlobalNotificationSource();
  const [activityTargets, setActivityTargets] = createStore<
    Partial<Record<ChannelsGroup, ChannelActivityTarget>>
  >({});
  const [acknowledgedNotificationIds, setAcknowledgedNotificationIds] =
    createStore<Record<string, boolean>>({});

  const channelsById = createMemo(
    () => new Map(channels().map((channel) => [channel.id, channel]))
  );

  const callStatusesByCallId = createMemo(
    () =>
      new Map(calls.callActivity().map((call) => [call.callId, call.status]))
  );

  const notificationActivity = createMemo(() => {
    const unreadChannelIds = new Set<string>();
    const unreadCounts: Record<ChannelsGroup, number> = {
      channels: 0,
      direct_messages: 0,
    };
    const notificationIdsByChannel = new Map<string, string[]>();
    const latestTargets: Partial<Record<ChannelsGroup, ChannelActivityTarget>> =
      {};
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
      const notificationIds =
        notificationIdsByChannel.get(notification.entity_id) ?? [];
      notificationIds.push(notification.id);
      notificationIdsByChannel.set(notification.entity_id, notificationIds);

      const channel = channelsById().get(notification.entity_id);
      if (!channel) continue;

      const group = channelGroup(channel);
      if (isFirstUnreadForChannel) unreadCounts[group] += 1;
      if (
        !latestTargets[group] &&
        !acknowledgedNotificationIds[notification.id]
      ) {
        latestTargets[group] = {
          channelId: channel.id,
          source: {
            type: 'notification',
            notificationId: notification.id,
          },
        };
      }
    }

    return {
      latestTargets,
      notificationIdsByChannel,
      unreadChannelIds,
      unreadCounts,
    };
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

  let activeCallStatuses = new Map<string, 'active' | 'incoming'>();

  createEffect(() => {
    const nextActiveCallStatuses = callStatusesByCallId();
    const recordedGroups = new Set<ChannelsGroup>();

    for (const call of calls.callActivity()) {
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

    return notificationActivity().latestTargets[group];
  };

  const targetChannelId = (group: ChannelsGroup) => target(group)?.channelId;

  const targetLabel = (group: ChannelsGroup) => {
    const source = target(group)?.source;
    if (!source) return;
    if (source.type !== 'call') return 'New activity';

    return callStatusesByCallId().get(source.callId) === 'incoming'
      ? 'Incoming call'
      : 'Active call';
  };

  const clearTarget = (group: ChannelsGroup, channelId: string) => {
    if (targetChannelId(group) !== channelId) return;

    for (const notificationId of notificationActivity().notificationIdsByChannel.get(
      channelId
    ) ?? []) {
      setAcknowledgedNotificationIds(notificationId, true);
    }

    if (activityTargets[group]?.channelId === channelId) {
      setActivityTargets(group, undefined);
    }
  };

  return {
    callStatuses: calls.callStatuses,
    clearTarget,
    incomingCallIds: calls.incomingCallIds,
    targetChannelId,
    targetLabel,
    unreadChannelIds: () => notificationActivity().unreadChannelIds,
    unreadCount: (group: ChannelsGroup) =>
      notificationActivity().unreadCounts[group],
  };
}
