import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import clickOutside from '@core/directive/clickOutside';
import type { Entity } from '@core/types';
import Bell from '@icon/regular/bell.svg';
import {
  type NotificationSource,
  useNotificationsForEntity,
} from '@notifications';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import { createMemo, Show, Suspense } from 'solid-js';
import { Notifications } from './Notifications';

false && clickOutside;
export const NOTIFICATIONS_DRAWER_ID = 'notifications';

export function NotificationsButton(props: {
  entity: Entity;
  notificationSource: NotificationSource;
  buttonSize?: 'sm';
}) {
  const drawerControl = useDrawerControl(NOTIFICATIONS_DRAWER_ID);
  const notifications = useNotificationsForEntity(
    props.notificationSource,
    props.entity
  );
  const unreadCount = createMemo(
    () => notifications().filter((n) => !n.viewed_at).length
  );
  return (
    <div class="relative" tabIndex={-1}>
      <Button
        class={cn(
          'px-1',
          drawerControl.isOpen() &&
            'bg-accent/20 hover:bg-accent/30 text-accent-ink'
        )}
        tooltip="View notifications"
        onClick={() => drawerControl.toggle()}
      >
        <Bell
          class={
            props.buttonSize === 'sm' ? 'size-4 shrink-0' : 'size-5 shrink-0'
          }
        />
      </Button>
      <Suspense fallback={null}>
        <Show when={unreadCount() > 0}>
          <div class="text-[6pt] bg-accent text-page font-semibold rounded-full absolute top-0 right-0 px-[4px] pointer-events-none">
            {unreadCount()}
          </div>
        </Show>
      </Suspense>
    </div>
  );
}

export function NotificationsDrawer(props: {
  entity: Entity;
  notificationSource: NotificationSource;
}) {
  const notifications = useNotificationsForEntity(
    props.notificationSource,
    props.entity
  );
  const unreadCount = createMemo(
    () => notifications().filter((n) => !n.viewed_at).length
  );
  const title = () => (
    <>
      Notifications
      <span class="text-ink-extra-muted">
        {unreadCount() > 0 ? ` - ${unreadCount()} unread` : ''}
      </span>
    </>
  );
  return (
    <SplitDrawer
      id={NOTIFICATIONS_DRAWER_ID}
      side="right"
      size={768}
      title={title()}
    >
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
  );
}

export type NotificationsModalProps = {
  entity: Entity;
  notificationSource: NotificationSource;
  buttonSize?: 'sm';
};

export function NotificationsModal(props: NotificationsModalProps) {
  const drawerControl = useDrawerControl(NOTIFICATIONS_DRAWER_ID);
  const notifications = useNotificationsForEntity(
    props.notificationSource,
    props.entity
  );

  const unreadCount = createMemo(() => {
    return notifications().filter((n) => !n.viewed_at).length;
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
        <Button
          suppressInteractionStyling
          class={cn(
            'aspect-square',
            props.buttonSize === 'sm' ? 'size-6' : 'size-8',
            drawerControl.isOpen()
              ? 'bg-accent/10 text-accent-ink hover:bg-accent/20'
              : 'text-ink hover:bg-hover'
          )}
          tooltip="View notifications"
          onClick={() => drawerControl.toggle()}
        >
          <Bell
            class={
              props.buttonSize === 'sm' ? 'size-4 shrink-0' : 'size-5 shrink-0'
            }
          />
        </Button>
        <Suspense fallback={null}>
          <Show when={unreadCount() > 0}>
            <div class="text-[6pt] bg-accent text-page font-semibold rounded-full absolute top-0 right-0 px-[4px] pointer-events-none">
              {unreadCount()}
            </div>
          </Show>
        </Suspense>
      </div>
      <SplitDrawer
        id={NOTIFICATIONS_DRAWER_ID}
        side="right"
        size={768}
        title={title()}
      >
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
