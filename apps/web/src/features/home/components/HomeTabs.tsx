import { PillTabs } from '@components/app/mobile/PillTabs';
import { useHomeView } from '../home-view-context';
import type { HomeTab } from '../types';
import { HomeFilterDrawer } from './HomeFilters';

const HOME_TABS: { value: HomeTab; label: string }[] = [
  { value: 'signal', label: 'Signal' },
  { value: 'noise', label: 'Noise' },
];

/**
 * Compact category switcher from the Activity-layout Home experiment, in the
 * touch list's floating header.
 */
export function HomeTabs() {
  const { state, setTab } = useHomeView();

  const handleTabChange = (value: string) => {
    const tab = HOME_TABS.find((item) => item.value === value);
    if (!tab) return;

    setTab(tab.value);
  };

  return (
    <div class="flex h-10 min-w-0 flex-1 items-center gap-2">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) min-w-0 flex-1"
        contentClass="px-(--mobile-chrome-gutter)"
        items={HOME_TABS}
        value={state.tab}
        onChange={handleTabChange}
      />
      <HomeFilterDrawer />
    </div>
  );
}
