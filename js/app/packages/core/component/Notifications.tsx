import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { NotificationRenderer } from '@core/component/NotificationRenderer';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import type { Entity } from '@core/types';
import { formatDate } from '@core/util/date';
import { notificationWithMetadata } from '@notifications/notificationMetadata';
import { navigateToNotification } from '@notifications/notificationNavigation';
import {
  extractNotificationData,
  NOTIFICATION_LABEL_BY_TYPE,
} from '@notifications/notificationPreview';
import type { NotificationSource } from '@notifications/notificationSource';
import type { UnifiedNotification } from '@notifications/types';
import { createMemo, For, Show } from 'solid-js';

export type NotificationsProps = {
  entity: Entity;
  notificationSource: NotificationSource;
};

export function Notifications(props: NotificationsProps) {
  const notifications = createMemo(() => {
    const entityNotifications =
      props.notificationSource.store[
        `${props.entity.type}@${props.entity.id}`
      ] ?? [];
    return entityNotifications.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });
  });

  const { replaceSplit, insertSplit } = useSplitLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();

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

  const handleNotificationClick = async (notification: UnifiedNotification) => {
    const typed = notificationWithMetadata(notification);
    if (!typed) return;

    const data = extractNotificationData(typed);
    if (data === 'no_extractor' || data === 'no_extracted_data') return;

    navigateToNotification({
      actions: {
        insertSplit,
        replaceSplit,
        messageLocation,
      },
      data,
    });

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
            const isUnread = !notification.viewedAt;
            const navHandlers = useSplitNavigationHandler(() =>
              handleNotificationClick(notification)
            );

            return (
              <button
                class={`w-full p-2 pb-3 border-b border-edge-muted hover:bg-hover text-left ${
                  isUnread ? 'bg-menu-hover' : 'bg-menu'
                }`}
                {...navHandlers}
              >
                <div class="flex justify-start items-center gap-2 mb-4 font-mono text-ink-muted text-xs uppercase">
                  <div
                    class={`size-2 ${
                      isUnread ? 'bg-accent' : 'bg-ink-extra-muted'
                    }`}
                  />
                  <div>
                    {
                      NOTIFICATION_LABEL_BY_TYPE[
                        notification.notificationEventType
                      ]
                    }
                  </div>
                  <div class="grow" />
                  <div>{formatDate(notification.createdAt)}</div>
                </div>

                <div class="flex flex-col gap-2 ml-4">
                  <NotificationRenderer
                    notification={notification}
                    mode="full"
                  />
                </div>

                <Show when={!notification.done}>
                  <div class="mt-2 pt-2 border-t border-edge-muted/25 ml-4">
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
