import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  type ChannelNotificationKind,
  type ChannelNotificationWitness,
  channelNotificationKind,
  channelNotificationWitness,
} from '@notifications/channel-notification-kind';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { isUnreadChannelThreadNotification } from '@notifications/unread-channel-thread-notification';
import { createChannelThreadUnreadQuery } from '@queries/channel/thread-unread-presence';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { type Accessor, createMemo } from 'solid-js';
import { channelThreadsUnreadQueryArgs } from '../core/channel-threads-query';

/** Shared presence without loading thread bodies or the GraphQL global feed. */
export function useChannelThreadsActivity(enabled: Accessor<boolean>) {
  const userId = useUserId();
  const source = useGlobalNotificationSource();
  const graphqlFlag = useFeatureFlag(enableGraphqlSoup);
  const input = createMemo(() =>
    makeGraphqlSoupInput(channelThreadsUnreadQueryArgs(userId() ?? ''))
  );
  const query = createChannelThreadUnreadQuery(
    input,
    () => enabled() && !!userId() && graphqlFlag().enabled
  );
  const activity = createMemo(() => {
    const notifications: Array<
      ChannelNotificationWitness & { channelId: string }
    > =
      !enabled() || !userId()
        ? []
        : !graphqlFlag().enabled
          ? source
              .notifications()
              .filter(isUnreadChannelThreadNotification)
              .map((notification) => ({
                ...channelNotificationWitness(notification),
                channelId: notification.entity_id,
              }))
          : query.isEnabled && !query.isLoading
            ? (query.data ?? []).map((notification) => ({
                ...notification,
                state: notificationStateFromGraphql(notification.state),
              }))
            : [];
    const localState = (notification: {
      id: string;
      state: 'unseen' | 'seen' | 'done';
    }) => source.withLocalState?.(notification) ?? notification.state;
    const channels = new Map<string, typeof notifications>();
    for (const notification of notifications) {
      const previous = channels.get(notification.channelId) ?? [];
      previous.push(notification);
      channels.set(notification.channelId, previous);
    }
    return {
      kind: channelNotificationKind(notifications, localState),
      channels: new Map(
        [...channels].map(([channelId, notifications]) => [
          channelId,
          channelNotificationKind(notifications, localState),
        ])
      ),
    };
  });
  return {
    kind: () => activity().kind,
    forChannel: (channelId: string): ChannelNotificationKind =>
      activity().channels.get(channelId) ?? 'none',
  };
}

export function useChannelThreadsNotificationKind(enabled: Accessor<boolean>) {
  return useChannelThreadsActivity(enabled).kind;
}

export function useChannelThreadsUnread(enabled: Accessor<boolean>) {
  const kind = useChannelThreadsNotificationKind(enabled);
  return () => kind() !== 'none';
}
