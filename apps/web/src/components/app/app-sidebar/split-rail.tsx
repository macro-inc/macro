import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import {
  isSideSplit,
  markSideSplit,
  SIDE_SPLIT_MIN_WIDTH,
} from '@components/app/split-layout/side-split-sizing';
import { TOKENS } from '@core/hotkey/tokens';
import { createMemo } from 'solid-js';
import { type SidebarItem, useSidebarLinks } from './links';
import { sidebarContent } from './navigation';
import { railGroups } from './rail-groups';
import {
  RailDestination,
  RailDestinations,
  useRailUnreadCounts,
} from './rail-parts';

/**
 * The right-hand companion to {@link SkinnySidebarRail}: the same destinations,
 * but a click docks one beside what you are already looking at instead of
 * taking it over — a narrow side split (a fifth of the viewport, never under
 * {@link SIDE_SPLIT_MIN_WIDTH}px), the way Google's suite rail works.
 *
 * A destination already docked toggles closed, so the rail reads as a set of
 * panels you switch on and off. Desktop only, rendered by `Layout` alongside
 * the left rail.
 */
export const SplitNavRail = () => {
  const links = useSidebarLinks();
  const unreadCounts = useRailUnreadCounts();
  const analytics = useAnalytics();

  const groups = createMemo(() => railGroups(links()));

  return (
    <nav
      aria-label="Side panel rail"
      data-ui="split-nav-rail"
      class="flex h-full w-11 shrink-0 flex-col items-center gap-1 overflow-hidden border-l border-edge-muted bg-surface py-2"
    >
      <RailDestinations
        groups={groups()}
        destination={(link) => (
          <RailDestination
            link={link}
            action="Open"
            hotkey={
              link.standaloneHotkey
                ? link.hotkeyToken
                : [TOKENS.sidebar.goToLeader, link.hotkeyToken]
            }
            unreadCount={() => unreadCounts().get(link.id)}
            active={() => isDockedSideSplit(globalSplitManager(), link)}
            onOpen={() => {
              analytics.track('sidebar_click', {
                view: link.id,
                surface: 'split-rail',
              });
              toggleSideSplit(globalSplitManager(), link);
            }}
          />
        )}
      />
    </nav>
  );
};

/** The live side split showing this destination, if it is docked right now. */
function dockedSideSplit(manager: SplitManager | undefined, link: SidebarItem) {
  if (!manager) return undefined;
  const content = sidebarContent(link.id, link.params);
  const split = manager.getSplitByContent(content.type, content.id);
  if (!split || !isSideSplit(split.id)) return undefined;
  return split;
}

function isDockedSideSplit(
  manager: SplitManager | undefined,
  link: SidebarItem
): boolean {
  return dockedSideSplit(manager, link) !== undefined;
}

/**
 * Dock a destination beside the current view, or undock it when it is already
 * there. Does nothing when the zone has no room left for a side split — the
 * gutters are the way out of that, not a surprise replacement of someone's
 * open view.
 */
function toggleSideSplit(
  manager: SplitManager | undefined,
  link: SidebarItem
): void {
  if (!manager) return;

  const docked = dockedSideSplit(manager, link);
  if (docked) {
    docked.close();
    return;
  }

  const canFitSideSplit =
    manager.resizeContext()?.canFit({ minSize: SIDE_SPLIT_MIN_WIDTH }) ?? true;
  if (!canFitSideSplit) return;

  const split = manager.createNewSplit({
    content: sidebarContent(link.id, link.params),
    activate: true,
    allowDuplicate: true,
    referredFrom: 'sidebar',
  });
  markSideSplit(split.id);
}
