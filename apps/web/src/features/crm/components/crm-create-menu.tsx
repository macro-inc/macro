import { ViewSidebar } from '@app/components/view-shell';
import BuildingsIcon from '@phosphor/buildings.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import TableIcon from '@phosphor/table.svg';
import UserIcon from '@phosphor/user.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

/** Sidebar create action for every CRM record type. */
export function CrmCreateMenu(props: {
  onCreateCompany(): void;
  onCreateContact(): void;
  /** Omitted while pipelines are unavailable to the viewer. */
  pipeline?: { disabled: boolean; onCreate(): void };
}) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger as={ViewSidebar.Action} aria-label="Create CRM record">
        <ViewSidebar.Icon>
          <PlusIcon class="size-4" />
        </ViewSidebar.Icon>
        <span class="truncate">New</span>
        <ViewSidebar.Trailing>
          <CaretDownIcon class="size-3 shrink-0" />
        </ViewSidebar.Trailing>
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Item onSelect={props.onCreateCompany}>
          <BuildingsIcon aria-hidden="true" class="size-4 shrink-0" />
          <span>Company</span>
        </Dropdown.Item>
        <Dropdown.Item onSelect={props.onCreateContact}>
          <UserIcon aria-hidden="true" class="size-4 shrink-0" />
          <span>Contact</span>
        </Dropdown.Item>
        <Show when={props.pipeline}>
          {(pipeline) => (
            <Dropdown.Item
              disabled={pipeline().disabled}
              onSelect={() => pipeline().onCreate()}
            >
              <TableIcon aria-hidden="true" class="size-4 shrink-0" />
              <span>Pipeline</span>
            </Dropdown.Item>
          )}
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
