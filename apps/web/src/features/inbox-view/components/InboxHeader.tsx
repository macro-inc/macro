import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { InboxFilterDropdown } from './InboxFilters';

function MobileInboxHeader(props: ParentProps) {
  return (
    <header class="flex shrink-0 flex-col gap-3 px-4 pt-2 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)] touch:absolute touch:inset-x-0 touch:top-0 touch:z-split-panel-chrome touch:pointer-events-none">
      <div class="flex h-8 min-w-0 items-center touch:h-10 touch:pointer-events-auto">
        {props.children}
      </div>
    </header>
  );
}

/** Keep mobile chrome above a full-height list so rows fade beneath it. */
export function InboxListLayout(
  props: ParentProps<{ tabs: JSX.Element; onNewChat: () => void }>
) {
  return (
    <div
      class="relative flex size-full min-h-0 min-w-0 flex-col"
      style={{
        '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 3.75rem)',
      }}
    >
      <Show
        when={isTouchDevice()}
        fallback={
          <SidebarCreateHeader
            title="Home"
            label="New chat"
            onCreate={props.onNewChat}
            titleActions={<InboxFilterDropdown />}
          />
        }
      >
        <MobileInboxHeader>{props.tabs}</MobileInboxHeader>
      </Show>
      {props.children}
      <Show when={isTouchDevice()}>
        <MobileTopEdgeFade />
      </Show>
    </div>
  );
}
