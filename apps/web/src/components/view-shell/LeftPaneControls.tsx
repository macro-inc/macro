import { t } from '@app/lib/i18n';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { TopBarIsland } from './touch-top-bar';
import { ViewSidebar } from './ViewSidebar';
import { useViewShellInternal } from './view-shell-context';

/**
 * Heads a wide-touch left pane with the view's name, in the style of the
 * navigation sheet's header, and ends with the control that collapses the
 * pane. It takes the top safe area, so the pane's content below starts
 * beneath it.
 */
export function LeftPaneTitleRow(props: { canCollapse: boolean }) {
  const ws = useViewShellInternal();
  return (
    <div
      class="flex h-[calc(var(--safe-top,0px)+3rem)] min-w-0 shrink-0 items-center justify-between gap-3 pt-(--safe-top) pr-(--sidebar-header-action-inset) pl-(--sidebar-content-inset)"
      data-view-shell-left-pane-title=""
    >
      <ViewSidebar.Title caret={false}>{ws.leftPane.title()}</ViewSidebar.Title>
      <Show when={props.canCollapse}>
        <Button
          aria-label={t('nav.hideSidePane')}
          variant="ghost"
          size="icon-xs"
          class="ml-auto shrink-0"
          data-view-shell-left-pane-toggle="collapse"
          onClick={() => ws.leftPane.collapse()}
        >
          <SidebarIcon class="size-4" />
        </Button>
      </Show>
    </div>
  );
}

/** The right pane's first island while the left pane is collapsed. */
export function LeftPaneExpandButton() {
  const ws = useViewShellInternal();
  return (
    <TopBarIsland class="pointer-events-auto">
      <Button
        aria-label={t('nav.showSidePane')}
        variant="ghost"
        size="icon-xs"
        class="shrink-0"
        data-view-shell-left-pane-toggle="expand"
        onClick={() => ws.leftPane.expand()}
      >
        <SidebarIcon class="size-4 touch:size-6" />
      </Button>
    </TopBarIsland>
  );
}

/**
 * Content below a left pane's title row, which has taken the top safe area:
 * the content's own chrome starts at the row's bottom edge.
 */
export function BelowLeftPaneTitle(props: {
  titled: boolean;
  children: JSX.Element;
}) {
  return (
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={props.titled ? { '--safe-top': '0px' } : undefined}
    >
      {props.children}
    </div>
  );
}
