import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
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

/** The message column's width on desktop (`macro-message-width`). */
const MESSAGE_COLUMN_WIDTH = 920;

/** A sender's first name, else their full name, or nothing while it loads. */
function senderName(userId: string) {
  const parts = getDisplayNameParts(tryMacroId(userId));
  return parts.firstName || parts.fullName || undefined;
}

/**
 * The channel gutter's notification list, behind one flag: a toggleable list
 * of what was unread when the channel opened, plus thread replies and
 * mentions that arrive while it is open. Reading leaves an entry listed;
 * its check marks the stack done. The not-done notifications load only once
 * the channel is on screen, so they never compete with the channel's own load.
 */
export function createChannelNotificationGutter(options: {
  channelId: string;
  /** The channel is open on desktop and has shown its first messages. */
  ready: Accessor<boolean>;
  /** The channel's unread notifications, read for its own unread markers. */
  unread: Accessor<readonly UnifiedNotification[]>;
  /** Whether `unread` is known yet. */
  unreadStatus: Accessor<StackListStatus>;
  /** `unread` came from the server, not only from cache. */
  unreadSettled: Accessor<boolean>;
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
  // Created with the channel, whatever the flag, so the first unread answer
  // is listed before the channel reads the messages on screen.
  const stacks = createChannelNotificationStacks({
    unread: options.unread,
    unreadSettled: options.unreadSettled,
    active,
    markDone: (marked, notifications) =>
      markStacksDone({
        channelId: options.channelId,
        stacks: marked,
        notifications,
        markNotifications: (records) =>
          notificationSource.bulkMarkAsDone(records),
      }),
  });

  const markDone = (marked: readonly ChannelStack[]) =>
    fireAndForget(stacks.markDone(marked), 'channel-notification-stacks');

  const openStack = (stack: ChannelStack) => {
    const { messageId, threadId } = stack.anchor;
    if (threadId) options.goToMessage(threadId, messageId);
    else options.goToMessage(messageId);
  };

  return {
    enabled,
    pane: options.pane,
    stacks: stacks.listed,
    status: options.unreadStatus,
    retry: options.retryUnread,
    markDone,
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
      stacks={gutter.stacks}
      status={gutter.status}
      onRetry={gutter.retry}
      senderName={senderName}
      onOpenStack={gutter.openStack}
      onMarkDone={gutter.markDone}
    />
  );
}

/**
 * Mark stacks done in their own span, recording counts and kinds, never
 * content, and telling the person when it fails. The local mark shows at once
 * and is rolled back on failure. Resolves whether it succeeded.
 */
async function markStacksDone(options: {
  channelId: string;
  stacks: readonly ChannelStack[];
  notifications: UnifiedNotification[];
  markNotifications: (notifications: UnifiedNotification[]) => Promise<void>;
}) {
  const notifications = options.notifications;
  if (notifications.length === 0) return true;

  return Telemetry.span(
    'channel.notification_stack.mark_done',
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
      if (result.isOk()) return true;

      span.error('channel.notification_stack.mark_done failed');
      toast.failure(t('channelNotificationStacks.markDoneFailed'));
      return false;
    }
  );
}
