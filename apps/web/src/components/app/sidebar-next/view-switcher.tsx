import type { ViewSwitcherProps } from '@app/components/view-shell';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  navigateToSidebarView,
  sidebarContent,
} from '@components/app/app-sidebar/sidebar';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Dropdown } from '@ui';
import { For, Show, useContext } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  moreMenuItems,
  type SidebarNextMenuItem,
  visibleNavItems,
} from './nav-items';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * Turns a view's name into a menu of the rail's destinations. Picking one
 * replaces the view in this split, so a split can change apps without first
 * being focused for the rail. Shift opens the destination in a new split.
 */
export function ViewSwitcher(props: ViewSwitcherProps) {
  const panel = useContext(SplitPanelContext);
  // Touch devices navigate with the dock, and popovers can't replace content.
  if (!panel || isTouchDevice() || panel.handle.isPopover()) {
    return <>{props.fallback ?? props.children}</>;
  }

  const gates = useNavItemGates();
  const layout = useSplitLayout();
  const analytics = useAnalytics();
  const hiddenItems = () => moreMenuItems(gates());
  const isCurrent = (item: SidebarNextMenuItem) =>
    sidebarContent(item.id, item.params).id === panel.handle.content().id;

  // Capture shift before onSelect fires (which omits the event).
  let shiftHeld = false;
  const captureSplitIntent = (event: PointerEvent | KeyboardEvent) => {
    shiftHeld = event.shiftKey;
  };

  const open = (item: SidebarNextMenuItem) => {
    analytics.track('sidebar_click', {
      view: item.id,
      source: 'view_switcher',
    });
    navigateToSidebarView({
      viewId: item.id,
      params: item.params,
      shiftKey: shiftHeld,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
  };

  const item = (navItem: SidebarNextMenuItem) => (
    <Dropdown.Item
      class="gap-2"
      aria-current={isCurrent(navItem) ? 'page' : undefined}
      onMouseEnter={() =>
        layout.preloadContent(sidebarContent(navItem.id, navItem.params))
      }
      onPointerDown={captureSplitIntent}
      onKeyDown={captureSplitIntent}
      onSelect={() => open(navItem)}
    >
      <Dynamic
        component={navItem.icon}
        class="size-4 shrink-0 text-ink-muted"
      />
      <span class="flex-1 truncate text-ink">{navItem.label}</span>
      <Show when={isCurrent(navItem)}>
        <CheckIcon class="size-4 shrink-0 text-ink-muted" />
      </Show>
    </Dropdown.Item>
  );

  // Size to the view name so short labels stay whole. Cap with `max-w-full`
  // only when the title row has a real width; a percentage `calc` treats an
  // indefinite parent as 0 and collapses "Chat" to "C…".
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class="-ml-2 w-max min-w-0 max-w-full"
        data-view-switcher=""
      >
        <span class="truncate text-sm font-semibold tracking-[-0.03em] text-ink">
          {props.children}
        </span>
        <Show when={props.caret}>
          <CaretDownIcon class="size-3 transition-transform in-data-expanded:rotate-180" />
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-[14rem]">
        <Dropdown.Group>
          <For each={visibleNavItems(gates())}>{item}</For>
        </Dropdown.Group>
        <Show when={hiddenItems().length > 0}>
          <Dropdown.Group>
            <For each={hiddenItems()}>{item}</For>
          </Dropdown.Group>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
