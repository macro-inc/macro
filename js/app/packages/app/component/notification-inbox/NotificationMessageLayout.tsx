import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { globalSplitManager } from '@app/signal/splitLayout';
import { openNotification, type UnifiedNotification } from '@notifications';
import { cn } from '@ui';
import { format } from 'date-fns';
import type { JSX } from 'solid-js';

const getNotificationDate = (notification: UnifiedNotification): Date =>
  new Date(notification.created_at ?? notification.updated_at ?? 0);

export function NotificationMessageLayout(props: {
  notification: UnifiedNotification;
  action: JSX.Element;
  actionIcon?: JSX.Element;
  icon: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  iconClass?: string;
}) {
  const notificationSource = useGlobalNotificationSource();
  const unread = () =>
    !props.notification.viewed_at && !props.notification.done;
  const timestamp = () =>
    format(getNotificationDate(props.notification), 'h:mm a');

  const handleOpen = async (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    await openNotification(props.notification, splitManager, e.shiftKey);
    await notificationSource.markAsRead(props.notification);
  };

  return (
    <div class="relative z-1 bg-surface">
      <div
        class="group/notif grid min-w-0 cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_4rem] grid-rows-[auto_auto] gap-x-2.5 gap-y-1.5 overflow-hidden rounded-lg px-2 py-2 hover:bg-ink-muted/6"
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen(e);
          }
        }}
      >
        <span class="col-start-1 row-start-1 row-span-2 grid size-4 place-items-center self-start pt-1">
          <span
            class={cn('size-1.5 rounded-full', {
              'bg-accent': unread(),
              'bg-transparent': !unread(),
            })}
          />
        </span>
        <div class="col-start-2 row-start-1 flex min-w-0 items-center gap-1 text-[11px] leading-3 text-ink-muted">
          {props.actionIcon}
          <span class="min-w-0 truncate">{props.action}</span>
        </div>
        <span class="col-start-3 row-start-1 justify-self-end text-xs text-right text-ink-extra-muted font-medium opacity-0 transition-opacity group-hover/notif:opacity-100">
          {timestamp()}
        </span>
        <div class="col-start-2 col-span-2 row-start-2 flex min-w-0 items-start gap-2.5">
          <span
            class={cn(
              'grid size-8 shrink-0 place-items-center',
              props.iconClass
            )}
          >
            {props.icon}
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="min-w-0 truncate text-xs font-medium text-ink">
              {props.title}
            </div>
            {props.description && (
              <div class="min-w-0 truncate text-xs text-ink-extra-muted">
                {props.description}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
