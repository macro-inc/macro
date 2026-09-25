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
  channels: Accessor<readonly ChannelEntity[]>,
  calls: ReturnType<typeof useChannelCalls>
) {
  const notificationSource = useGlobalNotificationSource();
  const [activityTargets, setActivityTargets] = createStore<
    Partial<Record<ChannelsGroup, ChannelActivityTarget>>
  >({});

  const channelsById = createMemo(
    () => new Map(channels().map((channel) => [channel.id, channel]))
  );

  const callStatusesByCallId = createMemo(
    () =>
      new Map(calls.callActivity().map((call) => [call.callId, call.status]))
  );

  const notificationActivity = createMemo(() => {
    const unreadChannelIds = new Set<string>();
    const unreadNotificationIds = new Set<string>();
    const unreadCounts: Record<ChannelsGroup, number> = {
      channels: 0,
      direct_messages: 0,
    };
    const latestTargets: Partial<Record<ChannelsGroup, ChannelActivityTarget>> =
      {};
    const notifications: {
      id: string;
      entity_id: string;
      created_at: DateValue;
    }[] = [];
    const legacyChannelIds = new Set<string>();
    for (const channel of channels()) {
      if (channel.unreadNotifications === undefined) {
        legacyChannelIds.add(channel.id);
        continue;
      }
      for (const notification of channel.unreadNotifications) {
        if (notification.state !== 'unseen') continue;
        notifications.push({
          id: notification.id,
          entity_id: channel.id,
          created_at: notification.createdAt,
        });
      }
    }
    // GraphQL lists use their own bounded edge, not a separately paginated feed.
    // Keep the existing fallback for REST/search rows without that projection.
    if (legacyChannelIds.size > 0) {
      notifications.push(
        ...notificationSource
          .notifications()
          .filter(
            (notification) =>
              notification.entity_type === 'channel' &&
              legacyChannelIds.has(notification.entity_id) &&
              !notificationIsRead(notification)
          )
      );
    }
    notifications.sort((a, b) => compareDateDesc(a.created_at, b.created_at));

    for (const notification of notifications) {
      const isFirstUnreadForChannel = !unreadChannelIds.has(
        notification.entity_id
      );
      unreadChannelIds.add(notification.entity_id);
      unreadNotificationIds.add(notification.id);

      const channel = channelsById().get(notification.entity_id);
      if (!channel) continue;

      const group = channelGroup(channel);
      if (isFirstUnreadForChannel) unreadCounts[group] += 1;
      if (!latestTargets[group]) {
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
      unreadChannelIds,
      unreadNotificationIds,
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
      if (channel) {
        recordActivity(channel, {
          type: 'notification',
          notificationId: notification.id,
        });
      }
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
    if (recordedTarget?.source.type === 'call') return recordedTarget;
    if (
      recordedTarget?.source.type === 'notification' &&
      notificationActivity().unreadNotificationIds.has(
        recordedTarget.source.notificationId
      )
    ) {
      return recordedTarget;
    }
    if (
      recordedTarget?.source.type === 'message' &&
      notificationActivity().unreadChannelIds.has(recordedTarget.channelId)
    ) {
      return recordedTarget;
    }

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

  return {
    callStatuses: calls.callStatuses,
    incomingCallIds: calls.incomingCallIds,
    targetChannelId,
    targetLabel,
    unreadChannelIds: () => notificationActivity().unreadChannelIds,
    unreadCount: (group: ChannelsGroup) =>
      notificationActivity().unreadCounts[group],
  };
}
