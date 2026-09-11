import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, type ParentProps, Show } from 'solid-js';

function InboxHeader(props: ParentProps) {
  return (
    <header class="flex shrink-0 flex-col gap-3 px-4 pt-2 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--safe-top,0px)+0.5rem)] touch:absolute touch:inset-x-0 touch:top-0 touch:z-split-panel-chrome touch:pointer-events-none">
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
            Notifications
          </h1>
        </div>
      </Show>
      <div class="flex h-8 min-w-0 items-center touch:h-10 touch:pointer-events-auto">
        {props.children}
      </div>
    </header>
  );
}

/** Keep mobile chrome above a full-height list so rows fade beneath it. */
export function InboxListLayout(props: ParentProps<{ tabs: JSX.Element }>) {
  return (
    <div
      class="relative flex size-full min-h-0 min-w-0 flex-col"
      style={{
        '--mobile-content-inset-top': 'calc(var(--safe-top, 0px) + 3.75rem)',
      }}
    >
      <InboxHeader>{props.tabs}</InboxHeader>
      {props.children}
      <Show when={isTouchDevice()}>
        <MobileTopEdgeFade />
      </Show>
    </div>
  );
}
