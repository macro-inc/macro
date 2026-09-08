import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ParentProps, Show } from 'solid-js';

export function InboxHeader(props: ParentProps) {
  return (
    <header class="shrink-0">
      <Show when={!isTouchDevice()}>
        <div class="flex h-12 min-w-0 items-center justify-between border-b border-edge-muted px-5">
          <h1 class="m-0 min-w-0 truncate text-xl font-semibold tracking-tight text-ink">
            Inbox
          </h1>
          <SplitPanel.ControlGroup>
            <SplitPanel.CloseButton />
          </SplitPanel.ControlGroup>
        </div>
      </Show>
      <div class="flex min-h-12 min-w-0 items-center border-b border-edge-muted px-3 py-2 mb-3 touch:border-b-0 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)]">
        {props.children}
      </div>
    </header>
  );
}
