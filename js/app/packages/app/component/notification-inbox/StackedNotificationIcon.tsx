import { Entity } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { cn } from '@ui';
import { Show } from 'solid-js';
import './NotificationListEntity.css';

export function StackedNotificationIcon(props: {
  notification: UnifiedNotification;
  count: number;
  reloading?: boolean;
}) {
  const visibleCount = () => Math.min(props.count, 3);
  const topY = () => (visibleCount() >= 3 ? 2 : visibleCount() === 2 ? 5 : 8);
  const iconTopClass = () => {
    if (visibleCount() >= 3) return 'top-[33%]';
    if (visibleCount() === 2) return 'top-[46%]';
    return 'top-[58%]';
  };

  return (
    <span class="relative block size-5 shrink-0 text-ink-muted">
      <svg
        viewBox="0 0 24 24"
        class="absolute inset-0 size-full text-ink-muted/45"
        aria-hidden="true"
      >
        <Show when={props.count > 3}>
          <rect
            x="5"
            y="8"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/3 stroke-current opacity-0',
              props.reloading && 'notification-stack-card-in'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <Show when={visibleCount() >= 3}>
          <rect
            x="5"
            y="8"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/3 stroke-current',
              props.reloading &&
                props.count > 3 &&
                'notification-stack-card-shift'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <Show when={visibleCount() >= 2}>
          <rect
            x="5"
            y="5"
            width="14"
            height="12"
            rx="2"
            class={cn(
              'notification-stack-svg-piece fill-ink-muted/3 stroke-current',
              props.reloading &&
                props.count > 3 &&
                'notification-stack-card-shift'
            )}
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </Show>
        <g
          class={cn(
            'notification-stack-svg-piece',
            props.reloading && 'notification-stack-card-out'
          )}
        >
          <rect
            x="5"
            y={topY()}
            width="14"
            height="12"
            rx="2"
            class="fill-surface stroke-current"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </g>
      </svg>
      <span
        class={cn(
          'absolute left-1/2 -translate-x-1/2 -translate-y-1/2',
          iconTopClass(),
          props.reloading && 'notification-stack-icon-out'
        )}
      >
        <Entity.Notification.Icon
          notification={props.notification}
          class="size-3"
        />
      </span>
    </span>
  );
}
