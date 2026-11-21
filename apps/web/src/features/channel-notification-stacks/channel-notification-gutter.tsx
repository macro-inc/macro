import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { ThreadGutter } from '@channel/Thread/ThreadGutterSlot';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { enableChannelNotificationGutter } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { UnifiedNotification } from '@notifications/types';
import { createChannelActiveNotificationsQuery } from '@queries/channel/active-notifications';
import { createElementSize } from '@solid-primitives/resize-observer';
import { type Accessor, Show, untrack } from 'solid-js';
import type { ChannelStack, StackListStatus } from './core/channel-stacks';
import { createChannelNotificationStacks } from './primitives/channel-notification-stacks';
import { createGutterPreferences } from './primitives/gutter-preferences';
import { NotificationList } from './views/notification-list';
import { stackChecksGutter } from './views/stack-checks';

/** The message column's width on desktop (`macro-message-width`). */
const MESSAGE_COLUMN_WIDTH = 920;

/** A sender's first name, else their full name, or nothing while it loads. */
function senderName(userId: string) {
  const parts = getDisplayNameParts(tryMacroId(userId));
  return parts.firstName || parts.fullName || undefined;
}

/**
 * The channel gutter's notification stacks, behind one flag: a Mark done
 * check beside each not-done stack, and a toggleable list of not-done or
 * unread stacks. The not-done notifications load only once the channel is
 * on screen, so they never compete with the channel's own load.
 */
export function createChannelNotificationGutter(options: {
  channelId: string;
  /** The channel is open on desktop and has shown its first messages. */
  ready: Accessor<boolean>;
  /** The channel's unread notifications, read for its own unread markers. */
  unread: Accessor<readonly UnifiedNotification[]>;
  /** Whether `unread` is known yet. */
  unreadStatus: Accessor<StackListStatus>;
  retryUnread: () => void;
  /** The element the message column is centered in. */
  pane: Accessor<HTMLElement | undefined>;
  /** Scroll the channel to a top-level message, or a reply in its thread. */
  goToMessage: (threadId: string, replyId?: string) => void;
}) {
  const flag = useFeatureFlag(enableChannelNotificationGutter);
  const enabled = () => options.ready() && flag().enabled;

  const notificationSource = useGlobalNotificationSource();
  const activeQuery = createChannelActiveNotificationsQuery(
    options.channelId,
    enabled
  );
  const active = () => {
    if (activeQuery.isPending) return undefined;
    const records = activeQuery.data ?? [];
    return notificationSource.withLocalOverrides
      ? records.map(notificationSource.withLocalOverrides)
      : records;
  };
  const stacks = createChannelNotificationStacks({
    active,
    unread: options.unread,
  });

  const mark = (kind: 'done' | 'read', marked: readonly ChannelStack[]) =>
    fireAndForget(
      markStacks({
        kind,
        channelId: options.channelId,
        stacks: marked,
        markNotifications: (notifications) =>
          kind === 'done'
            ? notificationSource.bulkMarkAsDone(notifications)
            : notificationSource.bulkMarkAsRead(notifications),
      }),
      'channel-notification-stacks'
    );

  const threadGutters = new Map<string, ThreadGutter>();

  // Cached stacks stay listed while a refresh fails.
  const notDoneStatus = (): StackListStatus => {
    if (activeQuery.data !== undefined) return 'ready';
    if (!activeQuery.isError) return 'loading';
    // A retry keeps the earlier error until its answer arrives.
    return activeQuery.isFetching ? 'retrying' : 'failed';
  };
  const status = {
    not_done: notDoneStatus,
    unread: options.unreadStatus,
  };
  const retry = {
    not_done: () => {
      fireAndForget(activeQuery.refetch(), 'channel-notification-stacks');
    },
    unread: options.retryUnread,
  };

  const openStack = (stack: ChannelStack) => {
    const { messageId, threadId } = stack.anchor;
    if (threadId) options.goToMessage(threadId, messageId);
    else options.goToMessage(messageId);
  };

  return {
    /** The checks may show, so the pane is a size container for their lane. */
    flagOn: () => flag().enabled,
    enabled,
    /** The checks a top-level message and its replies put in the gutter. */
    threadGutter: (rootId: string): ThreadGutter | undefined => {
      if (!enabled() || !stacks.notDoneByThread().has(rootId)) return;
      // One object per thread: a new one would rebuild its checks, and drop
      // their focus, on every notification change.
      let gutter = threadGutters.get(rootId);
      if (!gutter) {
        gutter = stackChecksGutter({
          stacks: () => stacks.notDoneByThread().get(rootId),
          senderName,
          onDone: (stack) => mark('done', [stack]),
        });
        threadGutters.set(rootId, gutter);
      }
      return gutter;
    },
    pane: options.pane,
    stacks,
    status,
    retry,
    mark,
    openStack,
  };
}

export type ChannelNotificationGutter = ReturnType<
  typeof createChannelNotificationGutter
>;

/** The gutter's toggle and list, when its flag is on. */
export function ChannelNotificationList(props: {
  gutter: ChannelNotificationGutter;
}) {
  return (
    <Show when={props.gutter.enabled()}>
      <MountedNotificationList gutter={props.gutter} />
    </Show>
  );
}

/** Measures the pane and restores the list's state only once it is shown. */
function MountedNotificationList(props: { gutter: ChannelNotificationGutter }) {
  const gutter = props.gutter;
  const preferences = createGutterPreferences(untrack(useUserId()));
  const paneSize = createElementSize(gutter.pane);
  const gutterWidth = () =>
    Math.max(0, ((paneSize.width ?? 0) - MESSAGE_COLUMN_WIDTH) / 2);

  return (
    <NotificationList
      gutterWidth={gutterWidth}
      open={preferences.open}
      onOpenChange={preferences.setOpen}
      view={preferences.view}
      onViewChange={preferences.setView}
      notDone={gutter.stacks.notDone}
      unread={gutter.stacks.unread}
      status={(view) => gutter.status[view]()}
      onRetry={(view) => gutter.retry[view]()}
      senderName={senderName}
      onOpenStack={gutter.openStack}
      onMarkDone={(stacks) => gutter.mark('done', stacks)}
      onMarkRead={(stacks) => gutter.mark('read', stacks)}
    />
  );
}

/**
 * Mark stacks done or read in their own span, recording counts and kinds,
 * never content, and telling the person when it fails. The local mark shows
 * at once and is rolled back on failure.
 */
async function markStacks(options: {
  kind: 'done' | 'read';
  channelId: string;
  stacks: readonly ChannelStack[];
  markNotifications: (notifications: UnifiedNotification[]) => Promise<void>;
}) {
  const notifications = options.stacks.flatMap((stack) => stack.notifications);
  if (notifications.length === 0) return;

  await Telemetry.span(
    `channel.notification_stack.mark_${options.kind}`,
    async (span) => {
      span.setAttr('channel.id', options.channelId);
      span.setAttr('notification_stack.count', options.stacks.length);
      span.setAttr(
        'notification_stack.kinds',
        [...new Set(options.stacks.map((stack) => stack.kind))].join(',')
      );
      span.setAttr('notification.count', notifications.length);

      const result = await catchToResult(() =>
        options.markNotifications(notifications)
      );
      if (result.isOk()) return;

      span.error(`channel.notification_stack.mark_${options.kind} failed`);
      toast.failure(
        options.kind === 'done'
          ? t('channelNotificationStacks.markDoneFailed')
          : t('channelNotificationStacks.markReadFailed')
      );
    }
  );
}
