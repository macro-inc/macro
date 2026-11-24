import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { settledDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  isGraphqlServerFault,
  isTransientRequestError,
} from '@core/util/request-error';
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

/** How long the device path waits for a pushed message to show. */
const UNREAD_ROOT_SETTLE_MS = 1_000;

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
  /**
   * Whether a pushed message reaches `messages` only after a reread (the
   * device path), so its notification can arrive before it does.
   */
  followsPushes?: Accessor<boolean>;
}) {
  const notificationSource = useGlobalNotificationSource();
  const channelNotifications = createChannelNotificationsQuery(
    options.channelId,
    () => true
  );
  // A server fault is retried like a transport failure; keep what we have.
  const failed = () => {
    const error = channelNotifications.error;
    return (
      !!error && !isTransientRequestError(error) && !isGraphqlServerFault(error)
    );
  };
  const notificationsStatus = ():
    | 'loading'
    | 'failed'
    | 'retrying'
    | 'ready' => {
    if (channelNotifications.isPending) return 'loading';
    if (!failed() && channelNotifications.data !== undefined) return 'ready';
    // A retry keeps the earlier error until its answer arrives.
    return channelNotifications.isFetching ? 'retrying' : 'failed';
  };
  const notifications = createMemo(() => {
    if (channelNotifications.isPending) return [];
    if (failed()) return [];
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
  const unloadedRoot = () => {
    const loaded = new Set(options.messages().map((message) => message.id));
    const target = unread().find((thread) => !loaded.has(thread.threadId));
    return target ? [target.threadId] : [];
  };
  // A pushed message shows once the device has reread it, which its
  // notification can beat: wait for the timeline to settle before asking the
  // server for it, or every push fetches its own message again.
  const settledRoot = settledDependent(unloadedRoot, [], UNREAD_ROOT_SETTLE_MS);
  const unreadRoots = useMessageTimelineByIdsQuery(
    () => ({ type: 'channel', id: options.channelId }),
    () => (options.followsPushes?.() ? settledRoot() : unloadedRoot())
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
    /** The channel's unread notifications, with local marks applied. */
    notifications,
    /** Whether `notifications` is known, or still loading or failed. */
    notificationsStatus,
    retryNotifications: () => {
      fireAndForget(
        channelNotifications.refetch(),
        'channel-unread-notifications'
      );
    },
    chip: unreadChip,
    unreadByThread,
    unreadByMessage,
    onMessageMount: destinationRegistry.registerMessage,
    onDisclosureMount: destinationRegistry.registerDisclosure,
  };
}
