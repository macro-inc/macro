import { ViewSidebar } from '@app/components/view-shell';
import { MobileListLayout } from '@app/components/view-shell/MobileListLayout';
import type { ParentProps } from 'solid-js';

/** The phone conversation feed, docked beside a preview on wide touch panes. */
export function ChannelsTouchSidebar(props: ParentProps) {
  return (
    <ViewSidebar.Root aria-label="Chat navigation">
      <MobileListLayout
        header={
          <div class="flex h-10 min-w-0 items-center justify-between gap-2">
            <ViewSidebar.Title caret={false}>Chat</ViewSidebar.Title>
            <ViewSidebar.Toggle action="collapse" />
          </div>
        }
      >
        {props.children}
      </MobileListLayout>
    </ViewSidebar.Root>
  );
}
