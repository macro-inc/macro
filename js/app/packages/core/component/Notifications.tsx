import { globalSplitManager } from '@app/signal/splitLayout';
import { NotificationRenderer } from '@core/component/NotificationRenderer';
import type { Entity } from '@core/types';
import { compareDateDesc, formatDate } from '@core/util/date';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  NOTIFICATION_LABEL_BY_TYPE,
  type NotificationSource,
  type UnifiedNotification,
} from '@notifications';
import { openNotification } from '@notifications/notification-navigation';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';

export type NotificationsProps = {
  entity: Entity;
  notificationSource: NotificationSource;
};

export function Notifications(props: NotificationsProps) {
  const notifications = createMemo(() => {
    const entityNotifications =
      props.notificationSource.notificationsByEntity()[
        `${props.entity.type}@${props.entity.id}`
      ] ?? [];
    return entityNotifications.sort((a, b) => {
      return compareDateDesc(a.created_at, b.created_at);
    });
  });

  const handleNotificationClick = async (notification: UnifiedNotification) => {
    const splitManager = globalSplitManager();
    if (!splitManager) return;

    openNotification(notification, splitManager);
    await props.notificationSource.markAsRead(notification);
  };

  return (
    <div class="flex flex-col">
      <Show
        when={notifications().length > 0}
        fallback={
          <div class="py-8 text-ink-muted text-sm text-center">
            No notifications found
          </div>
        }
      >
        <For each={notifications()}>
          {(notification) => {
            const isUnread = !notification.viewed_at;
            const navHandlers = useSplitNavigationHandler(() =>
              handleNotificationClick(notification)
            );

            return (
              <button
                class={cn(
                  'w-full p-2 pb-3 border-b border-edge-muted hover:bg-hover text-left',
                  isUnread ? 'bg-menu-hover' : 'bg-menu'
                )}
                {...navHandlers}
              >
                <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                  <div
                    class={cn(
                      'size-2',
                      isUnread ? 'bg-accent' : 'bg-ink-extra-muted'
                    )}
                  />
                  <div>
                    {
                      NOTIFICATION_LABEL_BY_TYPE[
                        notification.notification_metadata.tag
                      ]
                    }
                  </div>
                  <div class="grow" />
                  <div>
                    {formatDate(notification.created_at ?? new Date(0))}
                  </div>
                </div>

                <div class="flex flex-col gap-2 ml-4">
                  <NotificationRenderer
                    notification={notification}
                    mode="full"
                  />
                </div>

                <Show when={!notification.done}>
                  <div class="mt-2 pt-2 border-t border-edge-muted ml-4">
                    <button
                      class="text-accent text-xs hover:text-accent-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.notificationSource.markAsDone(notification);
                      }}
                    >
                      Mark as done
                    </button>
                  </div>
                </Show>
              </button>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
