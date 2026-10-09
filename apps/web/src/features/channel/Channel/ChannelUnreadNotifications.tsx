import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { compareTimelinePositions } from '@core/util/message-timeline';
import { isTransientRequestError } from '@core/util/request-error';
import { MessageNotificationIndexContext } from '@notifications/components/MarkMessageNotifications';
import { compositeEntity } from '@notifications/types';
import { indexUnreadMessageNotifications } from '@notifications/unread-message-notifications';
import { createChannelNotificationsQuery } from '@queries/channel/notifications';
import { queryReadyGate } from '@queries/gate';
import { useMessageTimelineByIdsQuery } from '@queries/messages/timeline';
import type {
  MessageListItem,
  TimelineActivity,
} from '@service-storage/messages';
import { type Accessor, createMemo, type JSX } from 'solid-js';
import type { ThreadListScrollState } from './ThreadList';
import {
  type ThreadPlacement,
  type ThreadPosition,
  type UnreadNotificationChip,
  type UnreadThread,
  unreadNotificationChip,
  unreadThreads,
} from './unread-thread-navigation';

/** Data and viewport wiring for the channel's unread navigation affordance. */
export function ChannelUnreadNotifications(props: {
  channelId: string;
  messages: Accessor<MessageListItem[]>;
  /** Activity rows can be the first visible row, so they need positions too. */
  activities?: Accessor<ReadonlyMap<string, TimelineActivity>>;
  /** The actual rendered order, including activity rows. */
  rowKeys?: Accessor<readonly string[]>;
  scrollState: Accessor<ThreadListScrollState | undefined>;
  container: Accessor<HTMLElement | undefined>;
  insets: Accessor<{ start: number; end: number }>;
  children: (chip: Accessor<UnreadNotificationChip | undefined>) => JSX.Element;
}) {
  const notificationSource = useGlobalNotificationSource();
  const graphqlNotifications = useFeatureFlag(enableGraphqlSoup);
  const channelNotifications = createChannelNotificationsQuery(
    props.channelId,
    () => graphqlNotifications().enabled
  );
  const notifications = createMemo(() => {
    if (!graphqlNotifications().enabled) {
      return (
        notificationSource.notificationsByEntity()[
          compositeEntity({ type: 'channel', id: props.channelId })
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
  // A reply's timestamp says nothing about where its parent sits in history.
  // Resolve only the target parent without loading the timeline around it.
  const unreadRoots = useMessageTimelineByIdsQuery(
    () => ({ type: 'channel', id: props.channelId }),
    () => {
      const id = unread()[0]?.threadId;
      return id && !props.messages().some((message) => message.id === id)
        ? [id]
        : [];
    }
  );
  const unreadChip = createMemo(() => {
    const unloaded = new Map<string, ThreadPosition>(
      (queryReadyGate(unreadRoots) ? unreadRoots.data : []).map((message) => [
        message.id,
        message,
      ])
    );

    const positions = new Map<string, ThreadPosition>(
      props.messages().map((message) => [message.id, message])
    );
    for (const [key, activity] of props.activities?.() ?? [])
      positions.set(key, { id: key, created_at: activity.occurred_at });
    const rows = props.rowKeys
      ? props.rowKeys().flatMap((key) => {
          const row = positions.get(key);
          return row ? [row] : [];
        })
      : props.activities
        ? [...positions.values()].sort((left, right) =>
            compareTimelinePositions(
              { id: left.id, createdAt: left.created_at },
              { id: right.id, createdAt: right.created_at }
            )
          )
        : props.messages();
    const scroll = props.scrollState();
    const container = props.container();
    const viewport = container?.querySelector('[data-channel-scroll]');
    const insets = props.insets();
    const place = (element: Element): ThreadPlacement => {
      const bounds = viewport!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return rect.bottom <= bounds.top + insets.start
        ? 'above'
        : rect.top >= bounds.bottom - insets.end
          ? 'below'
          : 'visible';
    };
    const measure = (thread: UnreadThread) => {
      if (!container || !viewport) return;
      const row = container
        .querySelector(`[data-message-id="${CSS.escape(thread.threadId)}"]`)
        ?.closest('[data-index]');
      // The unread message when it is rendered, otherwise the control that
      // reveals it while collapsed, otherwise the thread row around both.
      const element =
        container.querySelector(
          `[data-message-id="${CSS.escape(thread.messageId)}"]`
        ) ??
        row?.querySelector('[data-thread-collapsed-replies]') ??
        row;
      return element ? place(element) : undefined;
    };
    return unreadNotificationChip(
      unread(),
      { rows, unloaded },
      scroll?.didInitialScroll ? scroll.visibleRange : undefined,
      measure
    );
  });

  return (
    <MessageNotificationIndexContext.Provider value={unreadByMessage}>
      {props.children(unreadChip)}
    </MessageNotificationIndexContext.Provider>
  );
}
