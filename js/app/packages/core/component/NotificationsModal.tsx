import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import clickOutside from '@core/directive/clickOutside';
import type { Entity } from '@core/types';
import Bell from '@icon/regular/bell.svg';
import { useNotificationsForEntity } from '@notifications/notificationHelpers';
import type { NotificationSource } from '@notifications/notificationSource';
import { createMemo, Show, Suspense } from 'solid-js';
import { IconButton } from './IconButton';
import { Notifications } from './Notifications';

false && clickOutside;
const DRAWER_ID = 'notifications';

export type NotificationsModalProps = {
  entity: Entity;
  notificationSource: NotificationSource;
  buttonSize?: 'sm';
};

export function NotificationsModal(props: NotificationsModalProps) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  const notifications = useNotificationsForEntity(
    props.notificationSource,
    props.entity
  );

  const unreadCount = createMemo(() => {
    return notifications().filter((n) => !n.viewedAt).length;
  });

  const title = () => {
    return (
      <>
        Notifications
        <span class="text-ink-extra-muted">
          {unreadCount() > 0 ? ` - ${unreadCount()} unread` : ''}
        </span>
      </>
    );
  };

  return (
    <>
      <div class="relative" tabIndex={-1}>
        <IconButton
          icon={Bell}
          theme={drawerControl.isOpen() ? 'accent' : 'clear'}
          size={props.buttonSize ?? 'base'}
          tooltip={{ label: 'View notifications' }}
          onClick={() => {
            drawerControl.toggle();
          }}
        />
        <Suspense fallback={null}>
          <Show when={unreadCount() > 0}>
            <div class="text-[6pt] bg-accent text-page font-semibold rounded-full absolute top-0 right-0 px-[4px] pointer-events-none">
              {unreadCount()}
            </div>
          </Show>
        </Suspense>
      </div>
      <SplitDrawer id={DRAWER_ID} side="right" size={768} title={title()}>
        <Suspense
          fallback={
            <div class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
            </div>
          }
        >
          <Notifications
            entity={props.entity}
            notificationSource={props.notificationSource}
          />
        </Suspense>
      </SplitDrawer>
    </>
  );
}
