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
import { NO_ASSIGNEE } from '@app/component/next-soup/soup-view/task-sub-filter-matcher';
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

function FilterTrigger<T>(
  props: ParentProps<{
    filter: Accessor<T>;
  }>
) {
  return (
    <Popover.Trigger
      as="button"
      type="button"
      class="flex items-center gap-1 h-[22px] touch:mobile-width:h-9 px-2.5 shrink-0 rounded-full active:bg-accent/20 text-xs"
      classList={{
        'bg-accent/20 text-accent': !!props.filter(),
        'text-ink-muted hover:text-accent hover:bg-accent/20': !props.filter(),
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

  const activeLabel = () => {
    if (!statusFilter()) return 'Status';
    return (
      TASK_STATUS_OPTIONS.find((o) => o.value === statusFilter())?.label ??
      'Status'
    );
  };

  const selectOption = (id: string) => {
    setStatusFilter(statusFilter() === id ? undefined : id);
    setOpen(false);
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
          when={statusFilter()}
          fallback={<CircleDashedIcon class="size-3.5" />}
        >
          <PropertyValueIcon optionId={statusFilter()!} class="size-3.5" />
        </Show>
        <span class="leading-none">{activeLabel()}</span>
        <Show
          when={statusFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setStatusFilter(undefined);
            }}
          >
            <XIcon class="size-3" />
          </span>
        </Show>
      </FilterTrigger>
      <Popover.Portal>
        <Popover.Content class="z-50 bg-panel border border-edge-muted shadow-lg w-[300px]">
          <PropertyOptionSelector
            config={{ isMultiSelect: false, placeholder: 'Filter status...' }}
            options={statusOptions}
            isLoading={false}
            error={null}
            selectedOptions={() =>
              statusFilter() ? new Set([statusFilter()!]) : new Set()
            }
            onToggleOption={(id) => selectOption(id)}
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

  const activeAssigneeLabel = () => {
    if (!assigneeFilter()) return 'Assignee';
    if (assigneeFilter() === NO_ASSIGNEE) return 'No assignee';
    const contact = contacts().find((c) => c.id === assigneeFilter());
    if (contact && contact.id === userId())
      return contact.name ? `${contact.name} (me)` : 'Me';
    return contact?.name || assigneeFilter()!;
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
          when={assigneeFilter() !== NO_ASSIGNEE ? assigneeFilter() : undefined}
          keyed
          fallback={<UserCircleIcon class="size-3.5" />}
        >
          {(id) => (
            <UserIcon id={id} size="xs" suppressClick showTooltip={false} />
          )}
        </Show>
        <span class="leading-none">{activeAssigneeLabel()}</span>
        <Show
          when={assigneeFilter()}
          fallback={<CaretDownIcon class="size-3 opacity-60" />}
        >
          <span
            class="ml-0.5 hover:text-accent/60"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setAssigneeFilter(undefined);
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
              isMultiSelect: false,
              placeholder: 'Filter assignee...',
              specificEntityType: 'USER',
            }}
            pinnedOptions={[
              {
                id: NO_ASSIGNEE,
                label: 'No assignee',
                icon: <UserCircleIcon class="size-4 text-ink-muted" />,
              },
            ]}
            selectedOptions={() =>
              assigneeFilter() ? new Set([assigneeFilter()!]) : new Set()
            }
            setSelectedOptions={(ids) => {
              const newId = [...ids][0];
              setAssigneeFilter(newId === assigneeFilter() ? undefined : newId);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};
