import {
  type Accessor,
  type Component,
  type ParentProps,
  Show,
} from 'solid-js';
import { Popover } from '@kobalte/core/popover';
import { TASK_STATUS_OPTIONS } from '@entity';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { PropertyOptionSelector } from '@core/component/Properties/component/modal/shared/PropertyOptionSelector';
import { PropertyEntitySelector } from '@core/component/Properties/component/modal/shared/PropertyEntitySelector';
import type { SelectableOption } from '@core/component/Properties/component/modal/shared/types';
import { UserIcon } from '@core/component/UserIcon';
import { useContacts } from '@queries/contacts/contacts';
import { useUserId } from '@core/context/user';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import UserCircleIcon from '@icon/regular/user-circle.svg';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import XIcon from '@icon/regular/x.svg?component-solid';
import CircleDashedIcon from '@icon/regular/circle-dashed.svg';

type DropdownProps = {
  open: () => boolean;
  onOpenChange: (isOpen: boolean) => void;
};

const statusOptions: SelectableOption[] = TASK_STATUS_OPTIONS.map((o) => ({
  id: o.value,
  label: o.label,
}));

function FilterTrigger(
  props: ParentProps<{
    filter: Accessor<string[]>;
  }>
) {
  const hasFilter = () => props.filter().length > 0;
  return (
    <Popover.Trigger
      as="button"
      type="button"
      class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 px-2.5 shrink-0 rounded-full active:bg-accent/20 text-xs"
      classList={{
        'bg-accent/20 text-accent': hasFilter(),
        'text-ink-muted hover:text-accent hover:bg-accent/20': !hasFilter(),
      }}
    >
      {props.children}
    </Popover.Trigger>
  );
}

export const TaskStatusDropdown: Component<DropdownProps> = (props) => {
  const { statusFilter, setStatusFilter } = useSoupView();
  const open = () => props.open();
  const setOpen = (v: boolean) => props.onOpenChange(v);

  const hasFilter = () => statusFilter().length > 0;

  const activeLabel = () => {
    const filters = statusFilter();
    if (filters.length === 0) return 'Status';
    if (filters.length === 1) {
      return (
        TASK_STATUS_OPTIONS.find((o) => o.value === filters[0])?.label ??
        'Status'
      );
    }
    return `${filters.length} statuses`;
  };

  const toggleOption = (id: string) => {
    const current = statusFilter();
    if (current.includes(id)) {
      setStatusFilter(current.filter((s) => s !== id));
    } else {
      setStatusFilter([...current, id]);
    }
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
      }}
      placement="bottom-start"
      gutter={4}
    >
      <FilterTrigger filter={statusFilter}>
        <Show
          when={hasFilter() && statusFilter()[0]}
          fallback={<CircleDashedIcon class="size-3.5" />}
        >
          {(firstStatus) => (
            <PropertyValueIcon optionId={firstStatus()} class="size-3.5" />
          )}
        </Show>
        <span class="leading-none">{activeLabel()}</span>
        <Show
          when={hasFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setStatusFilter([]);
            }}
          >
            <XIcon class="size-3" />
          </span>
        </Show>
      </FilterTrigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-panel border border-edge-muted shadow-lg w-[300px]">
          <PropertyOptionSelector
            config={{ isMultiSelect: true, placeholder: 'Filter status...' }}
            options={statusOptions}
            isLoading={false}
            error={null}
            selectedOptions={() => new Set(statusFilter())}
            onToggleOption={toggleOption}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};

export const TaskAssigneeDropdown: Component<DropdownProps> = (props) => {
  const { assigneeFilter, setAssigneeFilter } = useSoupView();
  const open = () => props.open();
  const setOpen = (v: boolean) => props.onOpenChange(v);
  const contacts = useContacts();
  const userId = useUserId();

  const hasFilter = () => assigneeFilter().length > 0;

  const activeAssigneeLabel = () => {
    const filters = assigneeFilter();
    if (filters.length === 0) return 'Assignee';
    if (filters.length === 1) {
      const contact = contacts().find((c) => c.id === filters[0]);
      if (contact && contact.id === userId())
        return contact.name ? `${contact.name} (me)` : 'Me';
      return contact?.name || filters[0];
    }
    return `${filters.length} assignees`;
  };

  return (
    <Popover
      open={open()}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
      }}
      placement="bottom-start"
      gutter={4}
    >
      <FilterTrigger filter={assigneeFilter}>
        <Show
          when={hasFilter() && assigneeFilter()[0]}
          keyed
          fallback={<UserCircleIcon class="size-3.5" />}
        >
          {(id) => (
            <UserIcon id={id} size="xs" suppressClick showTooltip={false} />
          )}
        </Show>
        <span class="leading-none">{activeAssigneeLabel()}</span>
        <Show
          when={hasFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setAssigneeFilter([]);
            }}
          >
            <XIcon class="size-3" />
          </span>
        </Show>
      </FilterTrigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-panel border border-edge-muted shadow-lg w-[300px]">
          <PropertyEntitySelector
            config={{
              isMultiSelect: true,
              placeholder: 'Filter assignee...',
              specificEntityType: 'USER',
            }}
            selectedOptions={() => new Set(assigneeFilter())}
            setSelectedOptions={(ids) => {
              setAssigneeFilter([...ids]);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};
