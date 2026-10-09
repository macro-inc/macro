import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { isTransientRequestError } from '@core/util/request-error';
import { compositeEntity } from '@notifications/types';
import { indexUnreadMessageNotifications } from '@notifications/unread-message-notifications';
import { createChannelNotificationsQuery } from '@queries/channel/notifications';
import { queryReadyGate } from '@queries/gate';
import { useMessageTimelineByIdsQuery } from '@queries/messages/timeline';
import type {
  MessageListItem,
  TimelineActivity,
} from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';
import { createUnreadDestinationRegistry } from './create-unread-destination-registry';
import type { ThreadListScrollState } from './ThreadList';
import {
  type ThreadPosition,
  unreadDestinationPositions,
  unreadNotificationChip,
  unreadThreads,
} from './unread-thread-navigation';

/** Data and viewport wiring for the channel's unread navigation affordance. */
export function createChannelUnreadNavigation(options: {
  channelId: string;
  messages: Accessor<MessageListItem[]>;
  /** Activity rows can be the first visible row, so they need positions too. */
  activities?: Accessor<ReadonlyMap<string, TimelineActivity>>;
  scrollState: Accessor<ThreadListScrollState | undefined>;
  container: Accessor<HTMLElement | undefined>;
  insets: Accessor<{ start: number; end: number }>;
  onDestinationsChanged: () => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const graphqlNotifications = useFeatureFlag(enableGraphqlSoup);
  const channelNotifications = createChannelNotificationsQuery(
    options.channelId,
    () => graphqlNotifications().enabled
  );
  const notifications = createMemo(() => {
    if (!graphqlNotifications().enabled) {
      return (
        notificationSource.notificationsByEntity()[
          compositeEntity({ type: 'channel', id: options.channelId })
        ] ?? []
      );
    }
    if (!channelNotifications.isEnabled || channelNotifications.isPending)
      return [];
    if (
      channelNotifications.error &&
      !isTransientRequestError(channelNotifications.error)
    )
      return [];
    const records = channelNotifications.data ?? [];
    return notificationSource.withLocalOverrides
      ? records.map(notificationSource.withLocalOverrides)
      : records;
  });
  const unreadByMessage = createMemo(() =>
    indexUnreadMessageNotifications(notifications())
  );
  const unread = createMemo(() => unreadThreads(notifications()));
  const unreadByThread = createMemo(
    () =>
      new Map(unread().map((thread) => [thread.threadId, thread.messageIds]))
  );
  const destinationRegistry = createUnreadDestinationRegistry(() =>
    options.onDestinationsChanged()
  );
  // A reply's timestamp says nothing about where its parent sits in history.
  // Only the first unloaded unread parent can become the next target.
  // Resolve it without loading entire timelines or every offscreen thread.
  const unreadRoots = useMessageTimelineByIdsQuery(
    () => ({ type: 'channel', id: options.channelId }),
    () => {
      const loaded = new Set(options.messages().map((message) => message.id));
      const target = unread().find((thread) => !loaded.has(thread.threadId));
      return target ? [target.threadId] : [];
    }
  );
  const unreadChip = createMemo(() => {
    const positions = new Map<string, ThreadPosition>(
      (queryReadyGate(unreadRoots) ? unreadRoots.data : []).map((message) => [
        message.id,
        message,
      ])
    );
    for (const message of options.messages())
      positions.set(message.id, message);
    for (const [key, activity] of options.activities?.() ?? [])
      positions.set(key, { id: activity.id, created_at: activity.occurred_at });
    const scroll = options.scrollState();
    const container = options.container();
    const viewport = container?.querySelector('[data-channel-scroll]');
    const destinations =
      container && viewport
        ? unreadDestinationPositions(
            unread(),
            destinationRegistry.elements,
            viewport,
            options.insets()
          )
        : undefined;
    return unreadNotificationChip(
      unread(),
      positions,
      scroll?.didInitialScroll ? scroll.visibleRange : undefined,
      destinations
    );
  });

  return {
    chip: unreadChip,
    unreadByThread,
    unreadByMessage,
    onMessageMount: destinationRegistry.registerMessage,
    onDisclosureMount: destinationRegistry.registerDisclosure,
  };
}
