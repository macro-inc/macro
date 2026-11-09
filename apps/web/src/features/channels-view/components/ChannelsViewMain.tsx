import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';

export function ChannelsViewMain(props: {
  mobileLayout: boolean;
  children: JSX.Element;
}) {
  return (
    <ViewShell.Main
      class="relative overflow-hidden"
      style={
        props.mobileLayout
          ? {
              '--mobile-content-inset-top':
                'calc(var(--safe-top, 0px) + 3.75rem)',
            }
          : undefined
      }
    >
      <Show when={isTouchDevice()}>
        <ViewShell.Header
          class={
            props.mobileLayout
              ? 'pointer-events-none absolute inset-x-0 top-0 z-split-panel-chrome pb-0 empty:hidden touch:pt-[calc(var(--safe-top,0px)+0.5rem)] [&>button]:pointer-events-auto'
              : 'empty:hidden'
          }
        >
          <ViewSidebar.Toggle action="expand" presentation="pill" />
        </ViewShell.Header>
      </Show>
      {props.children}
    </ViewShell.Main>
  );
}
