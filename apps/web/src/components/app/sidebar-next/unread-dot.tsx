import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { cn } from '@ui';

/** Fixed geometry keeps the glyph still as unread state changes. */
export function SidebarUnreadDot(props: { active?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-sidebar-unread-dot
      class={cn(
        'pointer-events-none absolute right-1 top-1 rounded-full ring-2 ring-surface',
        'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
        props.active ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
      )}
    >
      <UnreadIndicator active class="size-1.5" />
    </span>
  );
}
