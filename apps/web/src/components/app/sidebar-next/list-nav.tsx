import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  navigateToSidebarView,
  type SidebarItem,
  SidebarOpenInSplitMenu,
  sidebarContent,
} from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { TOKENS } from '@core/hotkey/tokens';
import { useLocation } from '@solidjs/router';
import { Hotkey } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { SidebarNextNavItem } from './nav-items';
import { SidebarItemNext } from './sidebar-item-next';

export type ListNavProps = {
  item: SidebarNextNavItem;
  /** Suppresses the hover hotkey hint while the `g` leader overlay is up. */
  hotkeyVisible?: boolean;
  onContextMenuOpenChange?: (open: boolean) => void;
};

/**
 * A SidebarNext nav row: all of the behaviour (active detection, navigation,
 * shift-click into a new split, the open-in-split context menu), none of the
 * styling — that lives in {@link SidebarItemNext}.
 *
 * Named for the shape it grows into: each nav is expected to expand into a list
 * of its own live items (Email accounts, Chat channels, Drive files). The slot
 * for that is deliberately absent until there is a data source to fill it.
 */
export const ListNav = (props: ListNavProps) => {
  const [hovering, setHovering] = createSignal(false);
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

  const showHotkeyHint = () => hovering() && !props.hotkeyVisible;

  return (
    <SidebarOpenInSplitMenu
      content={content}
      onOpenChange={props.onContextMenuOpenChange}
      // The trigger defaults to `h-7`, which would clip the taller nav row.
      triggerClass="h-9"
    >
      <SidebarItemNext
        variant="nav"
        label={props.item.label}
        icon={props.item.icon}
        iconActive={props.item.iconActive}
        active={isActive()}
        data-sidebar-next-item={props.item.id}
        onMouseDown={navigate}
        onHoverChange={setHovering}
        trailing={
          showHotkeyHint() || props.hotkeyVisible ? (
            <ListNavHotkeyHint
              item={props.item}
              highlighted={props.hotkeyVisible === true}
            />
          ) : undefined
        }
      />
    </SidebarOpenInSplitMenu>
  );
};

/**
 * The `g`-leader hint at a row's right edge. Highlighted while the leader key
 * is armed, muted on plain hover.
 */
const ListNavHotkeyHint = (props: {
  item: SidebarItem;
  highlighted: boolean;
}) => (
  <Show
    when={props.highlighted}
    fallback={
      <div class="flex items-center gap-1 text-xxs font-normal text-ink-extra-muted">
        <span class="rounded-sm border border-ink/5 px-1.5 py-0.5">
          <Hotkey token={TOKENS.sidebar.goToLeader} />
        </span>
        <span class="rounded-sm border border-ink/5 px-1.5 py-0.5">
          <Hotkey token={props.item.hotkeyToken} />
        </span>
      </div>
    }
  >
    <div class="flex size-4 items-center justify-center overflow-hidden rounded-xs border border-accent/30 bg-accent/10 text-xs text-accent">
      <Hotkey token={props.item.hotkeyToken} />
    </div>
  </Show>
);
