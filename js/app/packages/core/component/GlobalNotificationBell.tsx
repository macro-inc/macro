import { useSplitLayout } from '@app/component/split-layout/layout';
import InboxIcon from '@icon/regular/bell.svg';
import {
  type NotificationSource,
  useUnreadNotifications,
} from '@notifications';
import { Show } from 'solid-js';

export type GlobalNotificationBellProps = {
  notificationSource: NotificationSource;
  onClick?: () => void;
};

export function GlobalNotificationBell(props: GlobalNotificationBellProps) {
  const { insertSplit } = useSplitLayout();
  const allUnreadNotifications = useUnreadNotifications(
    props.notificationSource
  );

  const unreadNotifications = () =>
    allUnreadNotifications().filter(
      (n) => !n.done && n.eventItemType !== 'email'
    );

  const unreadCount = () => unreadNotifications().length;

  const handleNotificationClick = async () => {
    insertSplit({
      type: 'component',
      id: 'unified-list',
    });
  };

  return (
    <button class={`flex items-center group`} onClick={handleNotificationClick}>
      <div
        class="relative shrink-0 group-hover:border-accent flex items-center justify-center text-xs p-1 gap-1 hover:bg-hover"
        classList={{
          'text-accent': unreadCount() > 0,
          'text-ink-muted': unreadCount() === 0,
        }}
      >
        <InboxIcon class="w-4 h-4" />
        <Show when={unreadCount() > 0}>
          <p>{unreadCount() > 99 ? '99+' : unreadCount()}</p>
        </Show>
      </div>
    </button>
  );
}
