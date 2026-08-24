import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import GearIcon from '@phosphor/gear.svg';
import { useLocation } from '@solidjs/router';
import { Button } from '@ui';
import { createMemo } from 'solid-js';
import { type SidebarItem, useSidebarLinks } from './links';
import { isSidebarViewActive, navigateToSidebarView } from './navigation';
import { railDigitBindings, railGroups } from './rail-groups';
import {
  RailDestination,
  RailDestinations,
  useRailUnreadCounts,
} from './rail-parts';

type SkinnySidebarRailProps = {
  /** Pin the full sidebar open — the rail's logo click. */
  onExpand: () => void;
  /** Peek the full sidebar as a hover overlay while the logo is hovered. */
  onPeekChange: (open: boolean) => void;
};

/**
 * The collapsed sidebar's visible surface: a narrow rail of destination icons
 * with their labels underneath, clustered so related views (Email + Calendar,
 * Channels + Calls, …) read as one block, each carrying its unread count.
 * Desktop only — `Layout` renders it in place of the wide sidebar while the
 * sidebar state is `slim`, and touch devices get the mobile dock instead.
 *
 * Clicking a destination opens it in the active split, like the wide sidebar's
 * rows; the right-hand `SplitNavRail` is the same set of destinations opening
 * into a narrow side split instead.
 */
export const SkinnySidebarRail = (props: SkinnySidebarRailProps) => {
  const links = useSidebarLinks();
  const unreadCounts = useRailUnreadCounts();
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const location = useLocation();

  const groups = createMemo(() => railGroups(links()));
  // Which single-key jump, if any, lands on each destination.
  const digitTokens = createMemo(() => {
    const tokens = new Map<string, HotkeyToken>();
    for (const binding of railDigitBindings(groups())) {
      tokens.set(binding.link.id, binding.token);
    }
    return tokens;
  });

  const goToHotkey = (link: SidebarItem): HotkeyToken | HotkeyToken[] => {
    const digit = digitTokens().get(link.id);
    if (digit) return digit;
    return link.standaloneHotkey
      ? link.hotkeyToken
      : [TOKENS.sidebar.goToLeader, link.hotkeyToken];
  };

  return (
    <nav
      aria-label="Navigation rail"
      data-ui="skinny-sidebar-rail"
      class="flex h-full w-16 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-edge-muted bg-surface py-2"
    >
      <Button
        aria-label="Expand sidebar"
        class="size-8 shrink-0 rounded-lg p-0 text-accent [&_svg]:size-4"
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

      <RailDestinations
        groups={groups()}
        destination={(link) => (
          <RailDestination
            link={link}
            showLabel
            action="Go to"
            hotkey={goToHotkey(link)}
            unreadCount={() => unreadCounts().get(link.id)}
            active={() =>
              isSidebarViewActive(link.id, link.params, location.pathname)
            }
            onOpen={(event) => {
              analytics.track('sidebar_click', {
                view: link.id,
                surface: 'rail',
              });
              navigateToSidebarView({
                viewId: link.id,
                params: link.params,
                shiftKey: event.shiftKey,
                activeSplit: globalSplitManager()?.activeSplit(),
                openWithSplit: layout.openWithSplit,
                referredFrom: 'sidebar',
              });
              globalSplitManager()?.returnFocus();
            }}
          />
        )}
      />

      <RailSettingsButton />
    </nav>
  );
};

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
      class="size-8 shrink-0 rounded-lg p-0 [&_svg]:size-4"
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
