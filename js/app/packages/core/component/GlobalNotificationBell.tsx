import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { NotificationRenderer } from '@core/component/NotificationRenderer';
import Bell from '@icon/regular/bell.svg';
import {
  type NotificationSource,
  openNotification,
  tryToTypedNotification,
  useUnreadNotifications,
} from '@notifications';
import { Show } from 'solid-js';

export type GlobalNotificationBellProps = {
  notificationSource: NotificationSource;
  onClick?: () => void;
};

export function GlobalNotificationBell(props: GlobalNotificationBellProps) {
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

  const handleNotificationClick = async () => {
    const notification = mostRecent();

    if (!notification) return;

    const nm = tryToTypedNotification(notification);
    const layoutManager = globalSplitManager();
    if (!nm || !layoutManager) return;

    openNotification(nm, layoutManager);

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
