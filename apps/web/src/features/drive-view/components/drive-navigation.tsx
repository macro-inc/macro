import { ViewSidebar } from '@app/components/view-shell';
import ClockIcon from '@phosphor/clock.svg';
import FilesIcon from '@phosphor/files.svg';
import UsersIcon from '@phosphor/users.svg';
import { For, type ParentComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DRIVE_TABS, type DriveLocation, type DriveTab } from '../core/types';

const icons = { owned: FilesIcon, recent: ClockIcon, shared: UsersIcon };

export type DriveLocationMenu = ParentComponent<{ location: DriveLocation }>;

export function DriveNavigation(props: {
  location: DriveLocation;
  onNavigate: (tab: DriveTab) => void;
  locationMenu: DriveLocationMenu;
}) {
  return (
    <ViewSidebar.Nav aria-label="Drive views">
      <For each={DRIVE_TABS}>
        {(tab) => (
          <props.locationMenu location={{ kind: 'tab', tab: tab.id }}>
            <ViewSidebar.Item
              active={
                props.location.kind === 'tab' && props.location.tab === tab.id
              }
              class="font-normal"
              onClick={() => props.onNavigate(tab.id)}
            >
              <Dynamic
                component={icons[tab.id]}
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="truncate">{tab.label}</span>
            </ViewSidebar.Item>
          </props.locationMenu>
        )}
      </For>
    </ViewSidebar.Nav>
  );
}
