import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  navigateToSidebarView,
  SidebarOpenInSplitMenu,
  sidebarContent,
} from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TOKENS } from '@core/hotkey/tokens';
import { useLocation } from '@solidjs/router';
import { Button, cn } from '@ui';
import { NavGlyph } from './nav-glyph';
import type { SidebarNextNavItem } from './nav-items';

export type ListNavProps = {
  item: SidebarNextNavItem;
  onContextMenuOpenChange?: (open: boolean) => void;
};

/**
 * A SidebarRail nav button: an icon-only `@ui` Button, plus the behaviour
 * behind it — active detection, navigation, shift-click into a new split, the
 * open-in-split context menu.
 *
 * There is no room for a label or a `g`-leader hint in a 36px square, so both
 * live in the tooltip instead.
 *
 * Named for the shape it grows into: each nav is expected to expand into a list
 * of its own live items (Email accounts, Chat channels, Drive files). The slot
 * for that is deliberately absent until there is a data source to fill it.
 */
export const ListNav = (props: ListNavProps) => {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const location = useLocation();

  const content = () => sidebarContent(props.item.id, props.item.params);

  // Read the manager signal live: it is undefined until the split layout
  // mounts, which happens after the sidebar.
  const isActive = () => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    // With no active split to match on, fall back to the URL path.
    if (!activeContent) {
      return location.pathname
        .split('/')
        .filter(Boolean)
        .includes(props.item.id);
    }
    const expected = content();
    return (
      activeContent.type === expected.type && activeContent.id === expected.id
    );
  };

  const navigate = (event: MouseEvent) => {
    if (event.button !== 0) return;
    // The row acts on mousedown to beat the focus change, so suppress the
    // default selection/focus behaviour.
    event.preventDefault();
    analytics.track('sidebar_click', { view: props.item.id });

    const activeSplit = globalSplitManager()?.activeSplit();
    const activeContent = activeSplit?.content();
    const expected = content();
    const isSameContent =
      activeContent?.type === expected.type && activeContent.id === expected.id;

    if (!isSameContent || event.shiftKey) {
      navigateToSidebarView({
        viewId: props.item.id,
        params: props.item.params,
        shiftKey: event.shiftKey,
        activeSplit,
        openWithSplit: layout.openWithSplit,
        referredFrom: 'sidebar',
      });
    }

    globalSplitManager()?.returnFocus();
  };

  return (
    <SidebarOpenInSplitMenu
      content={content}
      onOpenChange={props.onContextMenuOpenChange}
      // The trigger defaults to `w-full h-7`, which clips the square button.
      triggerClass="size-9"
    >
      <Button
        variant="ghost"
        size="icon-md"
        class={cn(
          'cursor-default rounded-xl duration-100 motion-reduce:transition-none',
          isActive() && 'border-ink/10 bg-ink/4 text-ink'
        )}
        label={props.item.label}
        tooltip={`Go to ${props.item.label}`}
        tooltipPlacement="right"
        hotkey={[TOKENS.sidebar.goToLeader, props.item.hotkeyToken]}
        draggable={false}
        aria-current={isActive() ? 'page' : undefined}
        // An attribute rather than a class-only state, so the styling can be
        // retargeted from CSS and the `data-active` selectors the old sidebar's
        // tests use keep working.
        data-active={isActive() ? '' : undefined}
        data-sidebar-next-item={props.item.id}
        onMouseDown={navigate}
      >
        <NavGlyph
          icon={props.item.icon}
          iconActive={props.item.iconActive}
          filled={isActive()}
          class="size-5"
        />
      </Button>
    </SidebarOpenInSplitMenu>
  );
};
