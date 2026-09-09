import { SidebarSettingsWidget } from '@components/app/app-sidebar/sidebar';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';

/** Account menu at the bottom of the rail. */
export const FooterActions = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => {
  const { openSettings, selectTab, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();

  // Same handling as `AppSidebar`: retarget the panel when it is already open
  // rather than reopening it, and ignore tabs this account cannot reach.
  const openSettingsTab = (tab: SettingsTab) => {
    if (!isTabAvailable(tab)) return;
    if (settingsOpen()) {
      selectTab(tab);
      return;
    }
    openSettings(tab);
  };

  return (
    <div class="flex w-full shrink-0 flex-col gap-2">
      {/*
        The account card from the old sidebar, reused whole. Its trigger already
        collapses to the bare avatar under that sidebar's slim contract, so the
        group is scoped to this wrapper — setting `data-slim` on the rail root
        would expose every descendant to those selectors.
      */}
      <div class="group/sidebar flex w-full justify-center" data-slim="true">
        <SidebarSettingsWidget
          compact
          isSlim={() => true}
          onSelect={openSettingsTab}
          onMenuOpenChange={props.onMenuOpenChange}
        />
      </div>
    </div>
  );
};
