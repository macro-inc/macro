import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import PushPinIcon from '@phosphor/push-pin.svg';
import PushPinSlashIcon from '@phosphor/push-pin-slash.svg';
import { Button, cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  MORE_MENU_ITEM_IDS,
  type MoreMenuItemId,
  moreMenuItems,
  type NavItemGates,
  type SidebarNextNavItem,
  visibleNavItems,
} from './nav-items';
import {
  isSidebarItemPinned,
  pinSidebarItem,
  unpinSidebarItem,
} from './use-sidebar-pinned-items';

export type MoreMenuProps = {
  gates: NavItemGates;
};

function MoreMenuItem(props: {
  item: SidebarNextNavItem;
  onNavigate: () => void;
}) {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const navigate = () => {
    analytics.track('sidebar_click', { view: props.item.id });
    navigateToSidebarView({
      viewId: props.item.id,
      params: props.item.params,
      shiftKey: false,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
    props.onNavigate();
  };

  return (
    <MenuItem
      text={props.item.label}
      onClick={navigate}
      icon={
        <Dynamic component={props.item.icon} class="size-4 text-ink-muted" />
      }
    />
  );
}

function PinnableItemRow(props: {
  item: SidebarNextNavItem;
  isPinned: boolean;
  onTogglePin: () => void;
  onNavigate: () => void;
}) {
  const analytics = useAnalytics();
  const layout = useSplitLayout();

  const navigate = () => {
    analytics.track('sidebar_click', { view: props.item.id });
    navigateToSidebarView({
      viewId: props.item.id,
      params: props.item.params,
      shiftKey: false,
      openWithSplit: layout.openWithSplit,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
    props.onNavigate();
  };

  return (
    <div class="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-hover">
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-default items-center gap-2 text-sm text-ink"
        onClick={navigate}
      >
        <Dynamic component={props.item.icon} class="size-4 text-ink-muted" />
        <span class="truncate">{props.item.label}</span>
      </button>
      <button
        type="button"
        class="flex size-5 cursor-default items-center justify-center rounded text-ink-extra-muted opacity-0 hover:bg-ink/5 hover:text-ink-muted group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          props.onTogglePin();
        }}
        title={props.isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
      >
        <Show when={props.isPinned} fallback={<PushPinIcon class="size-3.5" />}>
          <PushPinSlashIcon class="size-3.5" />
        </Show>
      </button>
    </div>
  );
}

function CustomizeSidebarSection(props: {
  gates: NavItemGates;
  onClose: () => void;
}) {
  const pinnedNavItems = () =>
    visibleNavItems(props.gates).filter((item) =>
      MORE_MENU_ITEM_IDS.includes(item.id as MoreMenuItemId)
    );

  const unpinnedItems = () => moreMenuItems(props.gates);

  const allConfigurableItems = () => {
    const pinned = pinnedNavItems();
    const unpinned = unpinnedItems();
    const pinnedIds = new Set(pinned.map((i) => i.id));
    return [...pinned, ...unpinned.filter((i) => !pinnedIds.has(i.id))];
  };

  const togglePin = (itemId: MoreMenuItemId) => {
    if (isSidebarItemPinned(itemId)) {
      unpinSidebarItem(itemId);
    } else {
      pinSidebarItem(itemId);
    }
  };

  return (
    <Show when={allConfigurableItems().length > 0}>
      <div class="-mx-1.5 my-1.5 h-px bg-edge-divider" />
      <div class="px-2 py-1">
        <span class="text-xs font-medium text-ink-muted">
          Customize sidebar
        </span>
      </div>
      <For each={allConfigurableItems()}>
        {(item) => (
          <PinnableItemRow
            item={item}
            isPinned={isSidebarItemPinned(item.id)}
            onTogglePin={() => togglePin(item.id as MoreMenuItemId)}
            onNavigate={props.onClose}
          />
        )}
      </For>
    </Show>
  );
}

/**
 * The "More" menu button in the sidebar rail, shown below CRM.
 * Provides access to Calls, Reviews tabs, and sidebar customization options.
 */
export function MoreMenu(props: MoreMenuProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const items = () => moreMenuItems(props.gates);

  const hasItems = () => items().length > 0;
  const hasAnyConfigurableItems = () =>
    props.gates.showCalls || props.gates.showReviews;

  return (
    <Show when={hasAnyConfigurableItems()}>
      <ContextMenu onOpenChange={setMenuOpen}>
        <ContextMenu.Trigger
          as="div"
          class="flex size-10 cursor-default items-center justify-center"
        >
          <Button
            variant="ghost"
            size="icon-md"
            class={cn(
              'size-10 cursor-default rounded-xl',
              menuOpen() && 'bg-hover text-ink'
            )}
            label="More"
            tooltip="More options"
            tooltipPlacement="right"
            draggable={false}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              const target = e.currentTarget as HTMLElement;
              target.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              );
            }}
          >
            <DotsThreeIcon class="size-5" />
          </Button>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenuContent class="min-w-[12rem] text-xs text-ink-muted">
            <Show when={hasItems()}>
              <For each={items()}>
                {(item) => (
                  <MoreMenuItem
                    item={item}
                    onNavigate={() => setMenuOpen(false)}
                  />
                )}
              </For>
            </Show>
            <CustomizeSidebarSection
              gates={props.gates}
              onClose={() => setMenuOpen(false)}
            />
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
}
