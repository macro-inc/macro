import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ParentProps, Show } from 'solid-js';

export function InboxHeader(props: ParentProps) {
  return (
    <header class="flex shrink-0 flex-col gap-3 px-4 pt-2 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)]">
      <Show when={!isTouchDevice()}>
        <div class="flex items-center">
          <SplitPanel.ControlGroup>
            <SplitPanel.CloseButton />
            <SplitPanel.BackButton />
            <SplitPanel.ForwardButton />
          </SplitPanel.ControlGroup>
        </div>
      </Show>
      <Show when={!isTouchDevice()}>
        <div class="flex h-8 min-w-0 items-center">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.035em] text-ink">
            Inbox
          </h1>
        </div>
      </Show>
      <div class="flex h-8 min-w-0 items-center touch:h-10">
        {props.children}
      </div>
    </header>
  );
}
