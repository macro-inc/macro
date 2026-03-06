import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { EntityType, NotificationType } from '@core/types';
import type { UnifiedNotification } from '@notifications/types';
import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import {
  EntityIcon,
  type EntityWithValidIcon,
} from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import ArrowBendUpLeftIcon from '@icon/regular/arrow-bend-up-left.svg';
import UserPlusIcon from '@icon/regular/user-plus.svg';
import { Dynamic } from 'solid-js/web';
import { useSenderName } from '@app/component/app-sidebar/utils';

const UNELIGIBLE_ENTITY_TYPES: EntityType[] = ['email', 'email_thread'];

type NotificationIconResult =
  | { type: 'entity'; icon: EntityWithValidIcon }
  | { type: 'svg'; icon: typeof ArrowBendUpLeftIcon }
  | { type: 'user' };

function getNotificationIcon(
  type: NotificationType,
  notification: UnifiedNotification
): NotificationIconResult {
  // Check if this is a DM - use user icon instead
  const isDM =
    type === 'channel_message_send' &&
    notification.notification_metadata.tag === 'channel_message_send' &&
    notification.notification_metadata.content.channelType === 'directMessage';

  if (isDM) {
    return { type: 'user' };
  }

  return match(type)
    .with('channel_mention', () => ({
      type: 'entity' as const,
      icon: 'channel' as EntityWithValidIcon,
    }))
    .with('mentioned_in_document_comment', () => ({
      type: 'entity' as const,
      icon: 'write' as EntityWithValidIcon,
    }))
    .with('channel_message_reply', () => ({
      type: 'svg' as const,
      icon: ArrowBendUpLeftIcon,
    }))
    .with('channel_message_send', () => ({
      type: 'entity' as const,
      icon: 'chat' as EntityWithValidIcon,
    }))
    .with('channel_invite', () => ({
      type: 'svg' as const,
      icon: UserPlusIcon,
    }))
    .with('invite_to_team', () => ({
      type: 'svg' as const,
      icon: UserPlusIcon,
    }))
    .with('task_assigned', () => ({
      type: 'entity' as const,
      icon: 'task' as EntityWithValidIcon,
    }))
    .otherwise(() => ({
      type: 'entity' as const,
      icon: 'chat' as EntityWithValidIcon,
    }));
}

function getNotificationLabel(type: NotificationType): string {
  return match(type)
    .with('channel_mention', () => '@You')
    .with('mentioned_in_document_comment', () => '@You')
    .with('channel_message_reply', () => '') // Show sender name instead
    .with('channel_message_send', () => '') // Show sender name instead for DMs
    .with('channel_invite', () => 'Channel invite')
    .with('invite_to_team', () => 'Team invite')
    .with('task_assigned', () => 'New task')
    .otherwise(() => '');
}

function getNotificationContent(notification: UnifiedNotification): string {
  const metadata = notification.notification_metadata;

  return match(metadata)
    .with({ tag: 'channel_mention' }, (m) => m.content.messageContent ?? '')
    .with(
      { tag: 'channel_message_send' },
      (m) => m.content.messageContent ?? ''
    )
    .with(
      { tag: 'channel_message_reply' },
      (m) => m.content.messageContent ?? ''
    )
    .with(
      { tag: 'channel_invite' },
      (m) => m.content.channelName ?? 'a channel'
    )
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text ?? '')
    .with({ tag: 'invite_to_team' }, (m) => m.content.teamName ?? '')
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? 'a task')
    .otherwise(() => '');
}

/** Gets contextual info like channel name or document name */
function getNotificationContext(
  notification: UnifiedNotification
): string | null {
  const metadata = notification.notification_metadata;

  return match(metadata)
    .with({ tag: 'channel_mention' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : null
    )
    .with({ tag: 'channel_message_send' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : 'DM'
    )
    .with({ tag: 'channel_message_reply' }, (m) =>
      m.content.channelName ? `#${m.content.channelName}` : null
    )
    .with({ tag: 'channel_invite' }, () => null)
    .with(
      { tag: 'mentioned_in_document_comment' },
      (m) => m.content.documentName ?? null
    )
    .with({ tag: 'invite_to_team' }, (m) =>
      m.content.invitedBy ? `by ${m.content.invitedBy}` : null
    )
    .with({ tag: 'task_assigned' }, (m) =>
      m.content.assignedBy ? `by ${m.content.assignedBy}` : null
    )
    .otherwise(() => null);
}

/** Renders the icon for a notification */
function NotificationItemIcon(props: {
  type: NotificationType;
  notification: UnifiedNotification;
}) {
  const iconResult = () => getNotificationIcon(props.type, props.notification);

  return (
    <Show
      when={iconResult().type === 'entity'}
      fallback={
        <Show
          when={iconResult().type === 'user'}
          fallback={
            <Dynamic
              component={
                (
                  iconResult() as {
                    type: 'svg';
                    icon: typeof ArrowBendUpLeftIcon;
                  }
                ).icon
              }
              class="size-4 text-ink-muted"
            />
          }
        >
          <Show when={props.notification.sender_id}>
            {(senderId) => (
              <UserIcon
                id={senderId()}
                size="xs"
                suppressClick
                showTooltip={false}
              />
            )}
          </Show>
        </Show>
      }
    >
      <EntityIcon
        targetType={
          (iconResult() as { type: 'entity'; icon: EntityWithValidIcon }).icon
        }
        size="xs"
      />
    </Show>
  );
}

function NotificationItem(props: {
  notification: UnifiedNotification;
  animate?: boolean;
}) {
  const [isVisible, setIsVisible] = createSignal(!props.animate);

  onMount(() => {
    if (props.animate) {
      // Small delay to ensure the initial state is rendered first
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  });

  const type = () =>
    props.notification.notification_event_type as NotificationType;

  const notificationContent = () => getNotificationContent(props.notification);

  const notificationContext = () => getNotificationContext(props.notification);

  const senderName = useSenderName(props.notification.sender_id);

  const isDM = () =>
    type() === 'channel_message_send' &&
    props.notification.notification_metadata.tag === 'channel_message_send' &&
    props.notification.notification_metadata.content.channelType ===
      'directMessage';

  const isReply = () => type() === 'channel_message_reply';

  const showSenderName = () => isDM() || isReply();

  return (
    <div
      class="flex items-start gap-3 p-2 hover:bg-surface-hover cursor-pointer transition-all duration-300 ease-out"
      classList={{
        'opacity-0 -translate-y-2': !isVisible(),
        'opacity-100 translate-y-0': isVisible(),
      }}
    >
      <div class="flex-shrink-0 mt-1">
        <NotificationItemIcon type={type()} notification={props.notification} />
      </div>

      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <span class="text-sm font-medium text-ink truncate">
          <Show when={showSenderName()} fallback={getNotificationLabel(type())}>
            {senderName()}
          </Show>
        </span>

        <Show when={notificationContext()}>
          <span class="text-xs text-ink-muted truncate">
            {notificationContext()}
          </span>
        </Show>

        <Show when={notificationContent()}>
          <p class="text-xs text-ink-muted truncate">{notificationContent()}</p>
        </Show>
      </div>
    </div>
  );
}

function filterUnreadNotDone(notifications: UnifiedNotification[]) {
  return notifications.filter(
    (n) =>
      !n.viewed_at &&
      !n.done &&
      !UNELIGIBLE_ENTITY_TYPES.includes(n.entity_type)
  );
}

export const UnreadNotificationsWidget = () => {
  const notificationSource = useGlobalNotificationSource();

  const allNotifications = () => [...notificationSource.notifications()];
  const filteredNotifications = createMemo(() =>
    filterUnreadNotDone(allNotifications())
  );

  return (
    <section class="w-full h-full flex flex-col">
      <header class="flex items-center justify-between py-1 px-2">
        <h1 class="text-sm font-medium text-ink-muted tracking-wide">
          Notifications
        </h1>
        <span class="flex-shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center text-xs font-medium bg-accent/10 text-accent rounded">
          {filteredNotifications().length}
        </span>
      </header>
      <div class="flex-1 overflow-y-auto pb-2 px-2">
        <For
          each={filteredNotifications()}
          fallback={
            <span class="text-ink/80 text-xs">No new notifications</span>
          }
        >
          {(notification) => (
            <NotificationItem notification={notification} animate={false} />
          )}
        </For>
      </div>
    </section>
  );
};
