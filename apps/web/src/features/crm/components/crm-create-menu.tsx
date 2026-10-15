import { ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateAction } from '@app/components/view-shell/SidebarCreateAction';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TableIcon from '@icon/system/regular/table.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

/** Create actions for every CRM record type. */
export function CrmCreateMenu(props: {
  presentation?: 'sidebar' | 'toolbar';
  record?: 'company' | 'contact';
  onCreateCompany(): void;
  onCreateContact(): void;
  /** Omitted while pipelines are unavailable to the viewer. */
  pipeline?: { disabled: boolean; onCreate(): void };
}) {
  return (
    <Dropdown placement="bottom-start">
      <Show
        when={props.presentation === 'toolbar'}
        fallback={
          <Dropdown.Trigger
            as={ViewSidebar.Action}
            aria-label="Create CRM record"
          >
            <ViewSidebar.Icon>
              <PlusIcon class="size-4" />
            </ViewSidebar.Icon>
            <span class="truncate">New</span>
            <ViewSidebar.Trailing>
              <CaretDownIcon class="size-3 shrink-0" />
            </ViewSidebar.Trailing>
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={SidebarCreateAction}
          aria-label="Create CRM record"
        >
          <span>New</span>
          <CaretDownIcon aria-hidden="true" class="size-3 shrink-0" />
        </Dropdown.Trigger>
      </Show>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
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
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
