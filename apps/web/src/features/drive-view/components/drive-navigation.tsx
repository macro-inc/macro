import { ViewSidebar } from '@app/components/view-shell';
import ClockIcon from '@phosphor/clock.svg';
import FilesIcon from '@phosphor/files.svg';
import UsersIcon from '@phosphor/users.svg';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DRIVE_TABS, type DriveLocation, type DriveTab } from '../core/types';

const icons = { owned: FilesIcon, recent: ClockIcon, shared: UsersIcon };

export function DriveNavigation(props: {
  location: DriveLocation;
  onNavigate: (tab: DriveTab) => void;
}) {
  return (
    <ViewSidebar.Nav aria-label="Drive views">
      <For each={DRIVE_TABS}>
        {(tab) => (
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
        )}
      </For>
    </ViewSidebar.Nav>
  );
}
