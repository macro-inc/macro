import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ParentProps, Show } from 'solid-js';

export function InboxHeader(props: ParentProps) {
  return (
    <header class="shrink-0 px-4 pb-3 pt-2 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)] @max-[480px]/view-shell:px-2 @max-[720px]/view-shell:px-3">
      <Show when={!isTouchDevice()}>
        <div class="flex min-h-7 items-center">
          <SplitPanel.ControlGroup>
            <SplitPanel.CloseButton />
            <SplitPanel.BackButton />
            <SplitPanel.ForwardButton />
          </SplitPanel.ControlGroup>
        </div>
      </Show>
      <Show when={!isTouchDevice()}>
        <div class="mt-1 flex min-h-10 min-w-0 items-center">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.035em] text-ink">
            Inbox
          </h1>
        </div>
      </Show>
      <div class="mt-3 flex min-h-10 min-w-0 items-center touch:mt-0">
        {props.children}
      </div>
    </header>
  );
}
