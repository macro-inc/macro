import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { ThreadGutter } from '@channel/Thread/ThreadGutterSlot';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import {
  enableChannelNotificationList,
  enableChannelStackDoneChecks,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { UnifiedNotification } from '@notifications/types';
import { createChannelActiveNotificationsQuery } from '@queries/channel/active-notifications';
import { createElementSize } from '@solid-primitives/resize-observer';
import { type Accessor, Show, untrack } from 'solid-js';
import type { ChannelStack } from './core/channel-stacks';
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
 * The channel gutter's notification stacks, behind their flags: a Mark done
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
  /** The element the message column is centered in. */
  pane: Accessor<HTMLElement | undefined>;
  /** Scroll the channel to a top-level message, or a reply in its thread. */
  goToMessage: (threadId: string, replyId?: string) => void;
}) {
  const checksFlag = useFeatureFlag(enableChannelStackDoneChecks);
  const listFlag = useFeatureFlag(enableChannelNotificationList);
  const checksEnabled = () => options.ready() && checksFlag().enabled;
  const listEnabled = () => options.ready() && listFlag().enabled;

  const notificationSource = useGlobalNotificationSource();
  const activeQuery = createChannelActiveNotificationsQuery(
    options.channelId,
    () => checksEnabled() || listEnabled()
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

  const openStack = (stack: ChannelStack) => {
    const { messageId, threadId } = stack.anchor;
    if (threadId) options.goToMessage(threadId, messageId);
    else options.goToMessage(messageId);
  };

  return {
    /** The checks may show, so the pane is a size container for their lane. */
    checksFlagOn: () => checksFlag().enabled,
    checksEnabled,
    listEnabled,
    /** The checks a top-level message and its replies put in the gutter. */
    threadGutter: (rootId: string): ThreadGutter | undefined => {
      if (!checksEnabled() || !stacks.notDoneByThread().has(rootId)) return;
      return stackChecksGutter({
        stacks: () => stacks.notDoneByThread().get(rootId),
        senderName,
        onDone: (stack) => mark('done', [stack]),
      });
    },
    pane: options.pane,
    stacks,
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
    <Show when={props.gutter.listEnabled()}>
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
      reserveCheckLane={gutter.checksEnabled}
      open={preferences.open}
      onOpenChange={preferences.setOpen}
      view={preferences.view}
      onViewChange={preferences.setView}
      notDone={gutter.stacks.notDone}
      unread={gutter.stacks.unread}
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
