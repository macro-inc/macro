import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useSplitRouter } from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  navigateToSidebarView,
  SidebarOpenInSplitMenu,
  sidebarContent,
} from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { TOKENS } from '@core/hotkey/tokens';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneCallIcon from '@phosphor-fill/phone-call-fill.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { NavGlyph } from './nav-glyph';
import type { SidebarNextNavItem } from './nav-items';
import { SidebarUnreadDot } from './unread-dot';
import { useSidebarPrefs } from './use-sidebar-prefs';

export type ListNavProps = {
  item: SidebarNextNavItem;
  unread?: boolean;
  activeCall?: boolean;
  /** A short status pill under the glyph, e.g. `Now` or `12m`. */
  badge?: string;
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
  const { hideSidebarItem } = useSidebarPrefs();
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const router = useSplitRouter();

  const content = () => sidebarContent(props.item.id, props.item.params);
  const preload = () => layout.preloadContent(content());

  // Split content mirrors the router's current entry, including the owning
  // workspace for nested details. Never infer selection from the multi-pane URL.
  const isActive = () => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (!activeContent) return false;
    const expected = content();
    if (
      props.item.id === 'agents' &&
      activeContent.type === 'component' &&
      parseAgentsRoute(activeContent.id)
    )
      return true;
    return (
      activeContent.type === expected.type && activeContent.id === expected.id
    );
  };

  const navigate = (event: MouseEvent) => {
    // The row acts on mousedown to beat the focus change, so suppress the
    // default selection/focus behaviour.
    event.preventDefault();
    analytics.track('sidebar_click', { view: props.item.id });

    const split = globalSplitManager()?.activeSplit();
    const selected = isActive();
    if (!event.shiftKey) {
      const pane = router.panes().find((pane) => pane.toString() === split?.id);
      // A later ordinary press also supersedes a pending Shift-open from this
      // pane. Cancelling preserves the current entry and split-owned state.
      if (pane) fireAndForget(router.cancelNavigation(pane), 'sidebar-nav');
    }
    if (!selected || event.shiftKey) {
      navigateToSidebarView({
        viewId: props.item.id,
        params: props.item.params,
        shiftKey: event.shiftKey,
        openWithSplit: layout.openWithSplit,
        referredFrom: 'sidebar',
      });
    }
    globalSplitManager()?.returnFocus();
  };

  // A primary press navigates on mousedown. The click that follows is a no-op,
  // but a click with no preceding mousedown still has to navigate: keyboard
  // activation (`detail` is 0 for those), or a trackpad tap whose mousedown
  // never reached us.
  let pressHandled = false;
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    pressHandled = true;
    navigate(event);
  };
  const onClick = (event: MouseEvent) => {
    const handled = pressHandled;
    pressHandled = false;
    if (event.button !== 0) return;
    if (handled && event.detail !== 0) return;
    navigate(event);
  };

  return (
    <SidebarOpenInSplitMenu
      content={content}
      onOpenChange={props.onContextMenuOpenChange}
      // The trigger defaults to `w-full h-7`, which clips the round button.
      triggerClass="size-10"
      additionalActions={
        <Show when={props.item.id !== 'home'}>
          <MenuSeparator />
          <MenuItem
            text="Hide from sidebar"
            onClick={() => hideSidebarItem(props.item.id)}
          />
        </Show>
      }
    >
      <Button
        variant="ghost"
        size="icon-md"
        class={cn(
          'size-10 cursor-default rounded-xl',
          isActive() && 'bg-hover text-ink'
        )}
        label={props.item.label}
        aria-description={
          [
            props.unread && 'Unread items',
            props.activeCall && 'Active call',
            props.badge && `Next meeting: ${props.badge}`,
          ]
            .filter(Boolean)
            .join('. ') || undefined
        }
        tooltip={`Go to ${props.item.label}`}
        tooltipPlacement="right"
        hotkey={
          props.item.hotkeyToken
            ? [TOKENS.sidebar.goToLeader, props.item.hotkeyToken]
            : undefined
        }
        draggable={false}
        aria-current={isActive() ? 'page' : undefined}
        // An attribute rather than a class-only state, so the styling can be
        // retargeted from CSS and tests can select the active item.
        data-active={isActive() ? '' : undefined}
        data-sidebar-next-item={props.item.id}
        data-unread={props.unread ? '' : undefined}
        data-active-call={props.activeCall ? '' : undefined}
        data-badge={props.badge}
        onMouseEnter={preload}
        onFocus={preload}
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <NavGlyph
          icon={props.item.icon}
          iconActive={props.item.iconActive}
          filled={isActive()}
          class="size-5"
        />
        <Show
          when={props.activeCall}
          fallback={<SidebarUnreadDot active={props.unread} />}
        >
          {/* Sits outside the button box: the glyph is inset from the
              corner, so a badge flush to it lands on the icon. The rail's
              horizontal padding absorbs the overhang. */}
          <span
            aria-hidden="true"
            class="pointer-events-none absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center text-accent"
          >
            <PhoneCallIcon class="size-full" />
          </span>
        </Show>
        <Show when={props.badge}>
          {(badge) => (
            <span
              aria-hidden="true"
              data-sidebar-badge
              class="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1 text-[9px] font-semibold leading-3 text-surface ring-2 ring-panel"
            >
              {badge()}
            </span>
          )}
        </Show>
      </Button>
    </SidebarOpenInSplitMenu>
  );
};
