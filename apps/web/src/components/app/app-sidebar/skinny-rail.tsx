import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import GearIcon from '@phosphor/gear.svg';
import { useLocation } from '@solidjs/router';
import { Button, cn } from '@ui';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type SidebarItem, useSidebarLinks } from './links';
import { isSidebarViewActive, navigateToSidebarView } from './navigation';
import {
  formatRailUnreadCount,
  railGroups,
  unreadCountsByLinkId,
} from './rail-groups';

type SkinnySidebarRailProps = {
  /** Pin the full sidebar open — the rail's logo click. */
  onExpand: () => void;
  /** Peek the full sidebar as a hover overlay while the logo is hovered. */
  onPeekChange: (open: boolean) => void;
};

/**
 * The collapsed sidebar's visible surface: a 30px rail of destination icons,
 * clustered so related views (Email + Calendar, Channels + Calls, …) read as
 * one block, each carrying its unread count. Desktop only — `Layout` renders it
 * in place of the wide sidebar while the sidebar state is `slim`, and touch
 * devices get the mobile dock instead.
 *
 * Labels live in the tooltips (with their `g`-leader shortcut), which is the
 * only place they fit at this width.
 */
export const SkinnySidebarRail = (props: SkinnySidebarRailProps) => {
  const links = useSidebarLinks();
  const notificationSource = useGlobalNotificationSource();

  const groups = createMemo(() => railGroups(links()));
  const unreadCounts = createMemo(() =>
    unreadCountsByLinkId(notificationSource.notifications())
  );

  return (
    <nav
      aria-label="Navigation rail"
      data-ui="skinny-sidebar-rail"
      class="flex h-full w-[30px] shrink-0 flex-col items-center gap-2 overflow-hidden border-r border-edge-muted bg-surface py-2"
    >
      <Button
        aria-label="Expand sidebar"
        class="size-6 shrink-0 rounded-md p-0 text-accent [&_svg]:size-4"
        label="Expand sidebar"
        hotkey={TOKENS.global.toggleSidebar}
        tooltipPlacement="right"
        noTouchResize
        onClick={() => props.onExpand()}
        onPointerEnter={() => props.onPeekChange(true)}
        onPointerLeave={() => props.onPeekChange(false)}
      >
        <LogoIcon />
      </Button>

      <div class="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
        <For each={groups()}>
          {(group) => (
            <ul
              data-rail-group={group.id}
              class="flex shrink-0 flex-col items-center gap-0.5 rounded-lg bg-ink/3 p-0.5"
            >
              <For each={group.items}>
                {(link) => (
                  <li class="flex items-center justify-center">
                    <RailLink
                      link={link}
                      unreadCount={() => unreadCounts().get(link.id)}
                    />
                  </li>
                )}
              </For>
            </ul>
          )}
        </For>
      </div>

      <RailSettingsButton />
    </nav>
  );
};

const RailLink = (props: {
  link: SidebarItem;
  /** Read lazily: the notification query behind it can suspend. */
  unreadCount: () => number | undefined;
}) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const location = useLocation();

  const link = () => props.link;
  const isActive = () =>
    isSidebarViewActive(link().id, link().params, location.pathname);

  return (
    <Button
      aria-label={`Go to ${link().label}`}
      data-rail-link={link().id}
      data-active={isActive() ? '' : undefined}
      class={cn(
        'relative size-6 rounded-md p-0 [&_svg]:size-3.5',
        isActive() && 'bg-ink/10 text-ink'
      )}
      label={`Go to ${link().label}`}
      hotkey={
        link().standaloneHotkey
          ? link().hotkeyToken
          : [TOKENS.sidebar.goToLeader, link().hotkeyToken]
      }
      tooltipPlacement="right"
      noTouchResize
      onMouseDown={(e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        analytics.track('sidebar_click', { view: link().id, surface: 'rail' });
        navigateToSidebarView({
          viewId: link().id,
          params: link().params,
          shiftKey: e.shiftKey,
          activeSplit: globalSplitManager()?.activeSplit(),
          openWithSplit: layout.openWithSplit,
          referredFrom: 'sidebar',
        });
        globalSplitManager()?.returnFocus();
      }}
    >
      <Show when={link().icon}>{(icon) => <Dynamic component={icon()} />}</Show>
      {/* Own boundary: an unread count that suspends must not blank the icon
          it sits on, let alone the rest of the rail. */}
      <Suspense>
        <RailUnreadBadge count={props.unreadCount} />
      </Suspense>
    </Button>
  );
};

const RailUnreadBadge = (props: { count: () => number | undefined }) => (
  <Show when={props.count()}>
    {(count) => (
      <span
        role="status"
        aria-label={`${count()} unread`}
        class="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent px-0.5 text-[8px] leading-none font-medium text-surface ring-1 ring-surface"
      >
        {formatRailUnreadCount(count())}
      </span>
    )}
  </Show>
);

const RailSettingsButton = () => {
  const { openSettings, selectTab, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();

  const openSettingsTab = (tab: SettingsTab) => {
    if (!isTabAvailable(tab)) return;
    if (settingsOpen()) {
      selectTab(tab);
      return;
    }
    openSettings(tab);
  };

  return (
    <Button
      aria-label="Settings"
      class="size-6 shrink-0 rounded-md p-0 [&_svg]:size-3.5"
      label="Settings"
      hotkey={TOKENS.global.toggleSettings}
      tooltipPlacement="right"
      noTouchResize
      onClick={() => openSettingsTab('Account')}
    >
      <GearIcon />
    </Button>
  );
};
