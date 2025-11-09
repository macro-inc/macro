import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { NotificationRenderer } from '@core/component/NotificationRenderer';
import Bell from '@icon/regular/bell.svg';
import { useUnreadNotifications } from '@notifications/notificationHelpers';
import { notificationWithMetadata } from '@notifications/notificationMetadata';
import {
  type NavigationActions,
  navigateToNotification,
} from '@notifications/notificationNavigation';
import { extractNotificationData } from '@notifications/notificationPreview';
import type { NotificationSource } from '@notifications/notificationSource';
import { Show } from 'solid-js';

export type GlobalNotificationBellProps = {
  notificationSource: NotificationSource;
  onClick?: () => void;
};

export function GlobalNotificationBell(props: GlobalNotificationBellProps) {
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const { insertSplit, replaceSplit } = useSplitLayout();
  const allUnreadNotifications = useUnreadNotifications(
    props.notificationSource
  );
  const notificationSource = useGlobalNotificationSource();

  const unreadNotifications = () =>
    allUnreadNotifications().filter(
      (n) => !n.done && n.eventItemType !== 'email'
    );

  const unreadCount = () => unreadNotifications().length;

  const mostRecent = () =>
    unreadNotifications().sort((a, b) => b.createdAt - a.createdAt)[0];

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

  const handleNotificationClick = async () => {
    const notification = mostRecent();

    if (!notification) return;

    const nm = notificationWithMetadata(notification);
    if (!nm) return;

    const notificationData = extractNotificationData(nm);
    if (typeof notificationData === 'string') {
      notificationSource.markAsRead(notification);
      return;
    }

    const actions: NavigationActions = {
      insertSplit,
      replaceSplit,
      messageLocation,
    };

    navigateToNotification({
      data: notificationData,
      actions,
    });

    notificationSource.markAsRead(notification);

    props.onClick?.();
  };

  return (
    <Show when={unreadCount() > 0}>
      <button
        class={`flex items-center group`}
        onClick={handleNotificationClick}
      >
        <div class="relative shrink-0 border border-ink-muted group-hover:border-accent flex items-center justify-center text-xs bg-ink-muted group-hover:bg-accent text-page p-1">
          <Bell class="w-4 h-4 text-page" />
          <Show when={unreadCount() > 0}>
            <p>{unreadCount() > 99 ? '99+' : unreadCount()}</p>
          </Show>
        </div>

        <div class="border border-ink-muted group-hover:border-accent px-2 py-1">
          <Show when={mostRecent()}>
            {(notification) => (
              <NotificationRenderer
                notification={notification()}
                mode="preview"
              />
            )}
          </Show>
        </div>
      </button>
    </Show>
  );
}
