import { useSplitLayout } from '@app/component/split-layout/layout';
import { StaticMarkdown, StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import { formatRelativeDate } from '@core/util/time';
import BellIcon from '@icon/regular/bell.svg';
import CheckIcon from '@icon/regular/check.svg';
import ChecksIcon from '@icon/regular/checks.svg';
import { getNotificationContent } from '@notifications/notification-metadata';
import type { UnifiedNotification } from '@notifications/types';
import {
  useMarkNotificationsAsDoneMutation,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const NOTIFICATIONS_LIMIT = 5;

interface NotificationsSectionProps {
  class?: string;
}

export function NotificationsSection(props: NotificationsSectionProps) {
  const notificationsQuery = useUserNotificationsQuery({
    limit: NOTIFICATIONS_LIMIT,
  });
  const markDoneMutation = useMarkNotificationsAsDoneMutation();

  const notifications = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.filter((n) => !n.done).slice(0, NOTIFICATIONS_LIMIT);
  });

  const handleMarkAllRead = () => {
    const ids = notifications().map((n) => n.id);
    if (ids.length > 0) {
      markDoneMutation.mutate({ notificationIds: ids });
    }
  };

  return (
    <DashboardSection
      title="Notifications"
      icon={<BellIcon />}
      accent="accent"
      class={props.class}
      fallback={<DashboardSectionLoading rows={4} />}
      headerAction={
        <Show when={notifications().length > 0}>
          <button
            type="button"
            onClick={handleMarkAllRead}
            class="flex items-center gap-1 text-xs text-ink-muted hover:text-ink transition-colors"
            title="Mark all as read"
          >
            <ChecksIcon class="size-3.5" />
            <span>Mark all read</span>
          </button>
        </Show>
      }
    >
      <NotificationsContent
        notifications={notifications()}
        onDismiss={(notification) =>
          markDoneMutation.mutate({ notificationIds: [notification.id] })
        }
      />
    </DashboardSection>
  );
}

function NotificationRow(props: {
  notification: UnifiedNotification;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const isUnread = () => !props.notification.viewed_at;
  const content = () => getNotificationContent(props.notification);

  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-start gap-3 py-2.5 px-3 group w-full text-left hover:bg-ink/5 rounded-lg transition-colors"
    >
      <div class="relative shrink-0">
        <Show
          when={props.notification.sender_id}
          fallback={
            <div class="size-7 rounded-full bg-ink/10 flex items-center justify-center">
              <BellIcon class="size-3.5 text-ink-muted" />
            </div>
          }
        >
          <UserIcon id={props.notification.sender_id!} size="sm" suppressClick />
        </Show>
        <Show when={isUnread()}>
          <div class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent border-2 border-surface" />
        </Show>
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="text-sm text-ink line-clamp-2 -mt-1">
          <Show when={content()} fallback="New notification">
            <StaticMarkdownContext>
              <StaticMarkdown markdown={content()!} />
            </StaticMarkdownContext>
          </Show>
        </div>
        <p class="text-xs text-ink-extra-muted">
          {formatRelativeDate(props.notification.created_at)}
        </p>
      </div>
      <div
        onClick={(e) => {
          e.stopPropagation();
          props.onDismiss();
        }}
        class="size-6 rounded flex items-center justify-center text-ink-muted opacity-0 group-hover:opacity-100 hover:bg-ink/10 transition-all shrink-0"
        title="Mark as done"
      >
        <CheckIcon class="size-3.5" />
      </div>
    </button>
  );
}

function NotificationsContent(props: {
  notifications: UnifiedNotification[];
  onDismiss: (notification: UnifiedNotification) => void;
}) {
  const { openWithSplit } = useSplitLayout();

  const handleNotificationClick = (notification: UnifiedNotification) => {
    const entityType = notification.entity_type;
    const entityId = notification.entity_id;

    if (entityType === 'document') {
      openWithSplit({ type: 'md', id: entityId });
    } else if (entityType === 'chat') {
      openWithSplit({ type: 'chat', id: entityId });
    } else if (entityType === 'channel') {
      openWithSplit({ type: 'channel', id: entityId });
    }
  };

  return (
    <Show
      when={props.notifications.length > 0}
      fallback={
        <DashboardEmptyState
          icon={<BellIcon />}
          title="No notifications"
          compact
        />
      }
    >
      <div class="flex flex-col -m-3">
        <For each={props.notifications}>
          {(notification) => (
            <NotificationRow
              notification={notification}
              onClick={() => handleNotificationClick(notification)}
              onDismiss={() => props.onDismiss(notification)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
