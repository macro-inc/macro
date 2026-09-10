import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  navigateToSidebarView,
  registerSidebarHotkeys,
  type SidebarState,
} from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
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
 * The rebuilt app sidebar, behind `enable-new-app-views`: a single always-narrow
 * column of 36px icon buttons, labels in tooltips.
 *
 * Always narrow by design — there is no slim mode and no hover-peek overlay, so
 * `cmd+.` hides the rail outright rather than collapsing it. The `g`-prefixed
 * nav shortcuts are unaffected: `GoToHotkeys` is mounted from `Layout` and does
 * not depend on which sidebar renders. There is no room for the leader-key
 * hints the old sidebar paints on its rows, so each button's tooltip carries
 * its shortcut instead.
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

  const _openHome = (event: MouseEvent) => {
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
      class={`relative flex h-full ${RAIL_WIDTH} shrink-0 flex-col items-center gap-2 overflow-hidden bg-surface px-3 pb-3 pt-3`}
    >
      <SidebarRailCreateButton />
      <SearchRailButton />

      <nav class="shrink-0 pt-5">
        <ul class="flex flex-col items-center gap-2">
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <ListNav item={item} />
              </li>
            )}
          </For>
        </ul>
      </nav>

      <div class="min-h-0 flex-1" />

      <FooterActions />
    </div>
  );
};
