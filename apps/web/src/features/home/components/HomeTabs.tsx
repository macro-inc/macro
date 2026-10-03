import { useViewTabHotkeys } from '@app/components/view-shell';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Tabs } from '@ui';
import { Show } from 'solid-js';
import { useHomeView } from '../home-view-context';
import type { HomeTab } from '../types';
import { HomeFilterDrawer, HomeFilterDropdown } from './HomeFilters';

const HOME_TABS: { value: HomeTab; label: string }[] = [
  { value: 'signal', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
];
const HOME_TAB_IDS = HOME_TABS.map((tab) => tab.value);

/** Compact category switcher from the Activity-layout Home experiment. */
export function HomeTabs() {
  const panel = useSplitPanelOrThrow();
  const { state, setTab } = useHomeView();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => HOME_TAB_IDS,
    activeId: () => state.tab,
    setActiveId: setTab,
  });

  const handleTabChange = (value: string) => {
    const tab = HOME_TABS.find((item) => item.value === value);
    if (!tab) return;

    setTab(tab.value);
  };

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <div class="flex h-8 min-w-0 flex-1 items-center gap-3">
          <Tabs
            aria-label="Home views"
            list={HOME_TABS}
            value={state.tab}
            onChange={handleTabChange}
          />
          <HomeFilterDropdown />
        </div>
      }
    >
      <div class="h-10 min-w-0 flex-1">
        <PillTabs
          scrollable
          class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
          contentClass="px-(--mobile-chrome-gutter)"
          leading={<HomeFilterDrawer />}
          items={HOME_TABS}
          value={state.tab}
          onChange={handleTabChange}
        />
      </div>
    </Show>
  );
}
