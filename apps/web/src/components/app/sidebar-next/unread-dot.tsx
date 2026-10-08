import {
  ChannelNotificationIndicator,
  type ChannelNotificationKind,
} from '@entity/components/ChannelNotificationIndicator';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { cn } from '@ui';
import { Show } from 'solid-js';

/** Fixed geometry keeps the glyph still as unread state changes. */
export function SidebarUnreadDot(props: {
  active?: boolean;
  kind?: ChannelNotificationKind;
}) {
  return (
    <span
      aria-hidden="true"
      data-sidebar-unread-dot
      class={cn(
        'pointer-events-none absolute right-1 top-1 rounded-full ring-2 ring-surface',
        props.active ? 'opacity-100' : 'opacity-0'
      )}
    >
      <Show
        when={props.kind !== undefined}
        fallback={<UnreadIndicator active class="size-1.5" />}
      >
        <ChannelNotificationIndicator
          kind={props.kind ?? 'none'}
          class="size-2.5"
        />
      </Show>
    </span>
  );
}
