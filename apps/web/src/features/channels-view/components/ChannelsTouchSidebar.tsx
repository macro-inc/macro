import { ViewSidebar } from '@app/components/view-shell';
import type { ParentProps } from 'solid-js';

/**
 * The phone conversation feed, docked beside a preview on wide touch panes.
 * Like the phone feed, it has no header: the feed starts below the safe area.
 */
export function ChannelsTouchSidebar(props: ParentProps) {
  return (
    <ViewSidebar.Root
      aria-label="Chat navigation"
      style={{ '--mobile-content-inset-top': 'var(--safe-top, 0px)' }}
    >
      {props.children}
    </ViewSidebar.Root>
  );
}
