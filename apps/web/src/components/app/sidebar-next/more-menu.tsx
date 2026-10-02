import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  customizableNavItems,
  moreMenuItems,
  type NavItemGates,
  type SidebarNextNavItem,
} from './nav-items';
import { moveSidebarItem, setSidebarItemVisible } from './use-sidebar-prefs';

export type MoreMenuProps = {
  gates: NavItemGates;
};

function navigateToItem(
  item: SidebarNextNavItem,
  openWithSplit: ReturnType<typeof useSplitLayout>['openWithSplit'],
  analytics: ReturnType<typeof useAnalytics>
) {
  analytics.track('sidebar_click', { view: item.id });
  navigateToSidebarView({
    viewId: item.id,
    params: item.params,
    shiftKey: false,
    openWithSplit,
    referredFrom: 'sidebar',
  });
  globalSplitManager()?.returnFocus();
}

function CustomizeRow(props: {
  item: SidebarNextNavItem;
  checked: boolean;
  index: number;
  count: number;
  orderIds: readonly string[];
}) {
  const isHome = () => props.item.id === 'home';
  const canMoveUp = () => !isHome() && props.index > 1;
  const canMoveDown = () => !isHome() && props.index < props.count - 1;

  return (
    <Dropdown.CheckboxItem
      checked={props.checked}
      disabled={isHome()}
      closeOnSelect={false}
      onChange={(checked) => setSidebarItemVisible(props.item.id, checked)}
    >
      <Dynamic
        component={props.item.icon}
        class="size-4 shrink-0 text-ink-muted"
      />
      <span class="min-w-0 flex-1 truncate">{props.item.label}</span>
      <Show when={!isHome()}>
        <div class="flex shrink-0 items-center -mr-1">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6"
            label={`Move ${props.item.label} up`}
            disabled={!canMoveUp()}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              moveSidebarItem(props.item.id, -1, props.orderIds);
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            <CaretUpIcon class="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6"
            label={`Move ${props.item.label} down`}
            disabled={!canMoveDown()}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              moveSidebarItem(props.item.id, 1, props.orderIds);
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            <CaretDownIcon class="size-3" />
          </Button>
        </div>
      </Show>
    </Dropdown.CheckboxItem>
  );
}

/**
 * The "More" menu button in the sidebar rail, shown below the main nav.
 * Lists hidden items for quick open, plus a Customize sidebar submenu with
 * checkboxes and reorder controls for every item except a locked Home.
 */
export function MoreMenu(props: MoreMenuProps) {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const hiddenItems = () => moreMenuItems(props.gates);
  const customizeItems = () => customizableNavItems(props.gates);
  const orderIds = () => customizeItems().map((item) => item.id);

  return (
    <Dropdown placement="right-start" gutter={6}>
      <Dropdown.Trigger
        variant="ghost"
        size="icon-md"
        class="size-10 cursor-default rounded-xl"
        label="More"
        tooltip="More options"
        tooltipPlacement="right"
        draggable={false}
        data-sidebar-next-item="more"
      >
        <DotsThreeIcon class="size-5" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-[14rem]">
        <Show when={hiddenItems().length > 0}>
          <Dropdown.Group>
            <For each={hiddenItems()}>
              {(item) => (
                <Dropdown.Item
                  class="gap-2"
                  onSelect={() =>
                    navigateToItem(item, layout.openWithSplit, analytics)
                  }
                >
                  <Dynamic
                    component={item.icon}
                    class="size-4 shrink-0 text-ink-muted"
                  />
                  <span class="flex-1 truncate text-ink">{item.label}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Show>

        <Dropdown.Group>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <span class="min-w-0 flex-1 truncate">Customize sidebar</span>
              <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent class="min-w-[16rem]">
              <Dropdown.Group>
                <Dropdown.GroupLabel>Show in sidebar</Dropdown.GroupLabel>
                <For each={customizeItems()}>
                  {(item, index) => (
                    <CustomizeRow
                      item={item}
                      checked={
                        item.id === 'home' ||
                        !props.gates.prefs.hidden.has(item.id)
                      }
                      index={index()}
                      count={customizeItems().length}
                      orderIds={orderIds()}
                    />
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
