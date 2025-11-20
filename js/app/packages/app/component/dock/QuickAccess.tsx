import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { Tooltip } from '@core/component/Tooltip';
import { UserIcon } from '@core/component/UserIcon';
import {
  isChannelMention,
  isChannelMessageReply,
  notificationIsRead,
  type UnifiedNotification,
} from '@notifications';
import type { ChannelWithLatest } from '@service-comms/generated/models';
import { useUserId } from '@service-gql/client';
import { NotificationEventType } from '@service-notification/generated/schemas';
import { createMemo, createSignal, For, Show } from 'solid-js';

// Helper functions for notification processing
function getNotificationDescription(notification: UnifiedNotification): string {
  switch (notification.notificationEventType) {
    case NotificationEventType.channel_mention:
      return 'mentioned in';
    case NotificationEventType.channel_message_reply:
      return 'replied in thread';
    case NotificationEventType.channel_message_send:
      return 'new messages in';
    default:
      return 'new activity in';
  }
}

function isHighPriorityNotification(
  notification: UnifiedNotification
): boolean {
  return (
    notification.eventItemType === 'channel' &&
    !notificationIsRead(notification) &&
    (notification.notificationEventType ===
      NotificationEventType.channel_mention ||
      notification.notificationEventType ===
        NotificationEventType.channel_message_reply ||
      notification.notificationEventType ===
        NotificationEventType.channel_message_send)
  );
}

type QuickAccessItemProps = {
  channel: ChannelWithLatest;
  notifications: UnifiedNotification[];
  notificationSource: ReturnType<typeof useGlobalNotificationSource>;
};

function QuickAccessItem(props: QuickAccessItemProps) {
  const userId = useUserId();
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const { replaceOrInsertSplit } = useSplitLayout();

  const messageLocation = async (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => {
    const blockHandle = await blockOrchestrator.getBlockHandle(channelId);
    await blockHandle?.goToLocationFromParams({
      message_id: messageId,
      thread_id: threadId,
    });
  };

  const navigateToMessage = (
    channelId: string,
    messageId: string,
    threadId?: string
  ) => {
    replaceOrInsertSplit({
      type: 'channel',
      id: channelId,
    });
    messageLocation(channelId, messageId, threadId);
  };

  const [currentNotificationIndex, setCurrentNotificationIndex] =
    createSignal(0);

  const unreadNotifications = createMemo(() =>
    props.notifications.filter((n) => !notificationIsRead(n))
  );

  const goToNextNotification = async () => {
    const notifications = unreadNotifications();
    const index = currentNotificationIndex();
    const notification = notifications[index] || notifications[0];
    const channelId = notification.eventItemId;

    if (isChannelMention(notification) || isChannelMessageReply(notification)) {
      const metadata = notification.notificationMetadata;
      if (metadata && metadata.messageId) {
        navigateToMessage(
          channelId,
          metadata.messageId,
          metadata.threadId || undefined
        );
      } else {
        replaceOrInsertSplit({ type: 'channel', id: channelId });
      }
    } else {
      // Default to channel for other notifications
      replaceOrInsertSplit({ type: 'channel', id: channelId });
    }

    const nextIndex = (currentNotificationIndex() + 1) % notifications.length;
    setCurrentNotificationIndex(nextIndex);
  };

  const getRecipientId = () => {
    if (props.channel.channel_type === 'direct_message') {
      let userIdValue = userId();
      let recipient = props.channel.participants.find(
        (p) => p.user_id !== userIdValue
      );
      return recipient?.user_id;
    }
    return undefined;
  };

  return (
    <Tooltip
      tooltip={
        <div>
          <p>
            {(() => {
              const notifications = unreadNotifications();
              const index = currentNotificationIndex();
              const notification = notifications[index] || notifications[0];
              if (!notification) return 'Click to open channel';
              return getNotificationDescription(notification);
            })()} <span class="font-bold">{props.channel.name}</span>
          </p>
          <div></div>
          <Show when={unreadNotifications().length > 1}>
            <div class="text-ink-muted text-xs">
              {currentNotificationIndex() + 1} of {unreadNotifications().length}
            </div>
          </Show>
        </div>
      }
      placement="top"
      floatingOptions={{
        offset: 18,
      }}
    >
      <div
        onMouseDown={goToNextNotification}
        class="relative flex justify-center items-center bg-panel hover:bg-panel-highlight border border-edge rounded-full size-8 transition-colors cursor-pointer select-none shrink-0"
      >
        <Show when={unreadNotifications().length > 0}>
          <div class="-top-1 -right-1 z-10 absolute bg-accent px-px rounded-full min-w-[1lh] font-mono font-bold text-[10px] text-panel text-center">
            {unreadNotifications().length}
          </div>
        </Show>
        <div class="flex flex-col items-center">
          <Show
            when={getRecipientId()}
            fallback={
              <div class="font-bold text-ink-muted text-xs">
                {props.channel.name?.[0]?.toUpperCase() ?? 'C'}
              </div>
            }
            keyed
          >
            {(id) => <UserIcon id={id} isDeleted={false} size="md" />}
          </Show>
        </div>
      </div>
    </Tooltip>
  );
}

export function QuickAccess() {
  const channelsContext = useChannelsContext();
  const channels = channelsContext.channels;
  const notificationSource = useGlobalNotificationSource();
  const allNotifications = notificationSource.notifications;
  const channelsWithNotifications = createMemo(() => {
    const channels_ = channels();
    const notifications = allNotifications();

    return channels_
      .map((channel) => {
        const channelNotifications = notifications
          .filter((notification) => {
            if (notification.eventItemId !== channel.id) return false;
            if (!isHighPriorityNotification(notification)) return false;

            // For DM channels, include all message notifications
            if (channel.channel_type === 'direct_message') return true;

            // For other channels, only include mentions and replies
            return (
              notification.notificationEventType ===
                NotificationEventType.channel_mention ||
              notification.notificationEventType ===
                NotificationEventType.channel_message_reply
            );
          })
          .sort((a, b) => {
            const getPriority = (n: UnifiedNotification) => {
              if (
                n.notificationEventType ===
                NotificationEventType.channel_mention
              )
                return 3;
              if (
                n.notificationEventType ===
                NotificationEventType.channel_message_reply
              )
                return 2;
              return 1; // channel_message_send for DMs
            };
            return getPriority(b) - getPriority(a);
          });

        return { channel, notifications: channelNotifications };
      })
      .filter((item) => item.notifications.length > 0) // Only show channels with notifications
      .sort((a, b) => b.notifications.length - a.notifications.length);
  });

  return (
    <div class="flex items-center gap-1.5 p-1">
      <For each={channelsWithNotifications()}>
        {(item) => (
          <QuickAccessItem
            channel={item.channel}
            notifications={item.notifications}
            notificationSource={notificationSource}
          />
        )}
      </For>
    </div>
  );
}
