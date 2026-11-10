import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show } from 'solid-js';

export function ChannelsViewMain(props: {
  mobileLayout: boolean;
  hasDetail?: boolean;
  children: JSX.Element;
}) {
  return (
    <ViewShell.Main
      class="relative overflow-hidden"
      style={
        props.mobileLayout
          ? {
              '--mobile-content-inset-top': 'var(--safe-top, 0px)',
            }
          : undefined
      }
    >
      <Show when={isTouchDevice() && !props.mobileLayout && !props.hasDetail}>
        <ViewShell.Header class="empty:hidden">
          <ViewSidebar.Toggle action="expand" presentation="pill" />
        </ViewShell.Header>
      </Show>
      {props.children}
    </ViewShell.Main>
  );
}
