import { useHasActiveChannelsCall } from '@app/features/channels-view/use-has-active-call';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { hotkeyScopeNeutralAttribute } from '@core/dom-selectors';
import { cn } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import { SidebarRailCreateButton } from './create-button';
import { FooterActions } from './footer-actions';
import { ListNav, type ListNavProps } from './list-nav';
import { MoreMenu } from './more-menu';
import { visibleNavItems } from './nav-items';
import { useSidebarUnread } from './queries/use-sidebar-unread';
import { SearchRailButton } from './search-bar-button';
import { useNavItemGates } from './use-nav-item-gates';
import { SidebarPrefsProvider } from './use-sidebar-prefs';

function ChannelsListNav(props: Omit<ListNavProps, 'activeCall'>) {
  const hasActiveCall = useHasActiveChannelsCall();
  return <ListNav {...props} activeCall={hasActiveCall()} />;
}

/**
 * The app sidebar: a single always-narrow column of 40px icon buttons, labels
 * in tooltips.
 *
 * Always narrow by design — there is no slim mode or hover-peek overlay.
 * `cmd+.` toggles navigation in the active workspace. The `g`-prefixed
 * nav shortcuts are registered by `GoToHotkeys`, which `Layout` mounts
 * separately. There is no room for leader-key hints on the buttons, so each
 * button's tooltip carries its shortcut instead.
 */
export const SidebarRail = () => (
  <SidebarPrefsProvider>
    <SidebarRailContent />
  </SidebarPrefsProvider>
);

const SidebarRailContent = () => {
  const gates = useNavItemGates();
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const hasUnread = useSidebarUnread();

  const _openHome = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    analytics.track('sidebar_click', { view: 'home' });
    navigateToSidebarView({
      viewId: 'home',
      shiftKey: event.shiftKey,
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

      <nav class="min-h-0 overflow-y-auto pt-4">
        <ul class="flex flex-col items-center gap-1">
          <For each={visibleNavItems(gates())}>
            {(item) => (
              <li class="flex">
                <Show
                  when={item.id === 'channels'}
                  fallback={<ListNav item={item} unread={hasUnread(item.id)} />}
                >
                  <Suspense
                    fallback={
                      <ListNav item={item} unread={hasUnread(item.id)} />
                    }
                  >
                    <ChannelsListNav item={item} unread={hasUnread(item.id)} />
                  </Suspense>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <MoreMenu gates={gates()} />

      <div class="min-h-0 flex-1" />

      <FooterActions />
    </div>
  );
};
