import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { useDriveView } from '../context/drive-context';
import { DRIVE_TABS, type DriveTab } from '../core/types';
import { DriveFilterDrawer } from './drive-filter-drawer';

export function DriveMobileTabs() {
  const { state } = useDriveView();

  const items = (): PillTabItem<DriveTab>[] =>
    DRIVE_TABS.map((tab) => ({ value: tab.id, label: tab.label }));

  // Inside a folder no tab is active; the title menu names the location.
  const activeTab = () => {
    const location = state.value().location;

    return location.kind === 'tab' ? location.tab : undefined;
  };

  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={<DriveFilterDrawer />}
        items={items()}
        value={activeTab()}
        onChange={state.selectTab}
      />
    </div>
  );
}
