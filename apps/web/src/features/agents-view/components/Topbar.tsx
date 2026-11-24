import { ViewShell } from '@app/components/view-shell/ViewShell';
import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import { SplitBackButton } from '@components/app/split-layout/components/SplitBackButton';
import { type JSX, Show } from 'solid-js';

/** Shared workspace chrome for conversation and new-session pages. */
export function Topbar(props: {
  title?: string;
  onBack?: () => void;
  titleContent?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar
      class="touch:flex"
      navigation={
        props.onBack ? (
          <ViewShell.TopBarIsland>
            <SplitBackButton onBack={props.onBack} />
          </ViewShell.TopBarIsland>
        ) : undefined
      }
    >
      <ViewShell.TopBarTitle>
        <div class="flex min-w-0 items-center gap-1">
          {props.titleContent ?? (
            <Show when={props.title}>
              <ViewSidebar.Title caret={false}>{props.title}</ViewSidebar.Title>
            </Show>
          )}
        </div>
      </ViewShell.TopBarTitle>
      <ViewShell.TopBarActions class="header-actions not-touch:gap-2">
        {props.children}
      </ViewShell.TopBarActions>
    </ViewShell.TopBar>
  );
}
