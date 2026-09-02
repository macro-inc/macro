import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  goToHotkeyVisible,
  navigateToSidebarView,
  registerSidebarHotkeys,
  type SidebarState,
} from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import { Tooltip } from '@ui';
import { For } from 'solid-js';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { ListNav } from './list-nav';
import { visibleNavItems } from './nav-items';
import { SearchRailButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';

export type SidebarRailProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
};

/** 36px buttons plus the 12px of padding either side. */
const RAIL_WIDTH = 'w-15';

/**
 * The always-narrow SidebarNext: the same navs and actions as `SidebarNext`,
 * reduced to a single column of 36px icon buttons with their labels in
 * tooltips.
 *
 * Shares `ListNav`, `FooterActions` and `SidebarItemNext` with the wide
 * version — only the arrangement differs — so a change to a nav's behaviour or
 * a row's chrome reaches both.
 */
export const SidebarRail = (props: SidebarRailProps) => {
  const gates = useNavItemGates();
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const isExpanded = () => (props.sidebarState ?? 'expanded') === 'expanded';

  // `cmd+.` lives on the rendered sidebar, so the rail has to register it too
  // or the shortcut goes dead whenever this replaces `AppSidebar`.
  registerSidebarHotkeys({
    isSlim: () => !isExpanded(),
    onOpenChange: props.onOpenChange,
  });

  const openHome = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'home' });
    navigateToSidebarView({
      viewId: 'home',
      shiftKey: event.shiftKey,
      activeSplit: globalSplitManager()?.activeSplit(),
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  return (
    <div
      {...hotkeyScopeNeutralAttribute}
      data-ui="sidebar-rail"
      class={`relative flex h-full ${RAIL_WIDTH} shrink-0 flex-col items-center gap-2 overflow-hidden bg-surface px-3 pb-3 pt-4`}
    >
      <Tooltip
        label="Home"
        hotkey={[TOKENS.sidebar.goToLeader, TOKENS.sidebar.goTo.home]}
        placement="right"
        as="span"
      >
        <button
          type="button"
          aria-label="Go to Home"
          data-sidebar-rail-home=""
          class="flex size-9 shrink-0 cursor-default select-none items-center justify-center rounded-xl text-accent outline-none transition-colors duration-150 ease-out hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
          onMouseDown={openHome}
        >
          <LogoIcon class="size-6" />
        </button>
      </Tooltip>

      <SidebarRailCreateButton />
      <SearchRailButton />

      <nav class="shrink-0 pt-8">
        <ul class="flex flex-col items-center gap-2">
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <ListNav
                  item={item}
                  variant="rail"
                  hotkeyVisible={goToHotkeyVisible()}
                />
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="min-h-0 flex-1" />

      <FooterActions orientation="column" />
    </div>
  );
};
