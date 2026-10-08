import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { navigateToSidebarView } from '@components/app/app-sidebar/sidebar';
import { useSplitLayout } from '@components/app/split-layout/layout';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CustomizeSidebarModal } from './customize-sidebar-modal';
import {
  moreMenuItems,
  type NavItemGates,
  type SidebarNextNavItem,
} from './nav-items';

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

/**
 * The "More" menu button in the sidebar rail, shown below the main nav.
 * Lists hidden items for quick open, and opens the Customize sidebar modal.
 */
export function MoreMenu(props: MoreMenuProps) {
  const [customizeSidebarOpen, setCustomizeSidebarOpen] = createSignal(false);
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const hiddenItems = () => moreMenuItems(props.gates);

  return (
    <>
      <Dropdown placement="right-start" gutter={6}>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-md"
          class="size-10 shrink-0 cursor-default rounded-xl"
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
            <Dropdown.Item onSelect={() => setCustomizeSidebarOpen(true)}>
              <span class="flex-1 truncate text-ink">Customize sidebar</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>

      <CustomizeSidebarModal
        gates={props.gates}
        open={customizeSidebarOpen()}
        onOpenChange={setCustomizeSidebarOpen}
      />
    </>
  );
}
