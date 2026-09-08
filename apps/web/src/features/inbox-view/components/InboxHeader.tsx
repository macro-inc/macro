import { ViewSidebar } from '@app/components/view-shell';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ParentProps, Show } from 'solid-js';

export function InboxHeader(props: ParentProps) {
  return (
    <div class="shrink-0">
      <Show when={!isTouchDevice()}>
        <ViewSidebar.Header>
          <ViewSidebar.Title>Inbox</ViewSidebar.Title>
          <SplitPanel.ControlGroup>
            <SplitPanel.CloseButton />
          </SplitPanel.ControlGroup>
        </ViewSidebar.Header>
      </Show>
      <div class="flex min-h-12 min-w-0 items-center border-b border-edge-muted px-3 py-2 mb-3 touch:border-b-0 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)]">
        {props.children}
      </div>
    </div>
  );
}
