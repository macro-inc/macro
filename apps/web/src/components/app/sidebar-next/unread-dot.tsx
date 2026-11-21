import { UnreadCount } from '@entity/components/UnreadCount';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { cn } from '@ui';
import { Show } from 'solid-js';

/**
 * A rail button's unread mark: a dot, or the count when the section has one.
 * Fixed geometry keeps the glyph still as unread state changes.
 */
export function SidebarUnreadDot(props: { active?: boolean; count?: string }) {
  return (
    <Show
      when={props.active && props.count}
      fallback={
        <span
          aria-hidden="true"
          data-sidebar-unread-dot
          class={cn(
            'pointer-events-none absolute right-1 top-1 rounded-full ring-2 ring-surface',
            props.active ? 'opacity-100' : 'opacity-0'
          )}
        >
          <UnreadIndicator active class="size-1.5" />
        </span>
      }
    >
      {(count) => (
        // Anchored to the button's right edge: the rail's scroller clips
        // anything past it, so a longer count grows towards the glyph.
        <UnreadCount
          label={count()}
          data-sidebar-unread-count
          class="absolute right-0 top-0.5 ring-surface"
        />
      )}
    </Show>
  );
}
