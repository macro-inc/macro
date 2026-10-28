import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { useDriveView } from '../context/drive-context';
import {
  DRIVE_MOBILE_TABS,
  type DriveMobileTab,
  driveMobileTabLocation,
} from '../core/types';
import { DriveFilterDrawer } from './drive-filter-drawer';

export function DriveMobileTabs() {
  const { state } = useDriveView();

  const items = (): PillTabItem<DriveMobileTab>[] =>
    DRIVE_MOBILE_TABS.map((tab) => ({ value: tab.id, label: tab.label }));

  // Folders covers the folder overview and any folder inside it; tapping the
  // pill from inside a folder returns to the overview.
  const activeTab = (): DriveMobileTab => {
    const location = state.value().location;

    return location.kind === 'folder' ? 'folders' : location.tab;
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
        onChange={(tab) => state.navigate(driveMobileTabLocation(tab))}
      />
    </div>
  );
}
