import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { useActiveCallsQuery } from '@queries/call/call';
import { cn } from '@ui';
import { For } from 'solid-js';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { ListNav } from './list-nav';
import { visibleNavItems } from './nav-items';
import { useSidebarUnread } from './queries/use-sidebar-unread';
import { SearchRailButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * The rebuilt app sidebar, behind `enable-new-app-views`: a single always-narrow
 * column of 40px icon buttons, labels in tooltips.
 *
 * Always narrow by design — there is no slim mode or hover-peek overlay.
 * `cmd+.` toggles navigation in the active workspace. The `g`-prefixed
 * nav shortcuts are unaffected: `GoToHotkeys` is mounted from `Layout` and does
 * not depend on which sidebar renders. There is no room for the leader-key
 * hints the old sidebar paints on its rows, so each button's tooltip carries
 * its shortcut instead.
 */
export const SidebarRail = () => {
  const gates = useNavItemGates();
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const hasUnread = useSidebarUnread();
  const activeCallsQuery = useActiveCallsQuery();
  // Keep the rail mounted while the shared call query loads.
  const hasActiveCall = () =>
    !activeCallsQuery.isPending && (activeCallsQuery.data?.length ?? 0) > 0;

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
      class={cn(
        'relative flex h-full w-14 shrink-0 flex-col items-center gap-1 overflow-hidden border-edge-frame bg-panel px-2 pb-3 pt-2',
        (globalSplitManager()?.splits().length ?? 1) <= 1 && 'border-r'
      )}
    >
      <SidebarRailCreateButton />
      <SearchRailButton />

      <nav class="shrink-0 pt-4">
        <ul class="flex flex-col items-center gap-1">
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <ListNav
                  item={item}
                  unread={hasUnread(item.id)}
                  activeCall={item.id === 'channels' && hasActiveCall()}
                />
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
